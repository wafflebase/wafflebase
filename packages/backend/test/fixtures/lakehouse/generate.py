#!/usr/bin/env python3
"""Regenerate the semantic Lakehouse integration fixture contract.

The generated object names and bytes are intentionally not stable: Iceberg and
Delta assign fresh UUIDs, snapshot IDs, and timestamps. This script instead
fixes and verifies the schema, append sequence, history length, and row set at
every historical point before publishing a staged output directory.
"""

from __future__ import annotations

import argparse
import importlib.metadata
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import tempfile
from typing import Any
from urllib.parse import urlparse


BUCKET = "lakehouse-fixtures"
ICEBERG_PREFIX = "iceberg"
ICEBERG_TABLE = "default.events"
ROWS = (
    {"id": 1, "value": "alpha"},
    {"id": 2, "value": "beta"},
    {"id": 3, "value": "gamma"},
)
PINNED_PACKAGES = {
    "deltalake": "1.6.2",
    "pyarrow": "25.0.0",
    "pyiceberg": "0.11.1",
    "SQLAlchemy": "2.0.51",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate and verify three-commit Iceberg and Delta fixtures into "
            "a new staging directory."
        )
    )
    parser.add_argument(
        "--output",
        required=True,
        type=Path,
        help="new directory to create; an existing path is never overwritten",
    )
    parser.add_argument(
        "--endpoint",
        default=os.environ.get(
            "LAKEHOUSE_MINIO_ENDPOINT", "http://127.0.0.1:19000"
        ),
        help="empty disposable MinIO endpoint (default: %(default)s)",
    )
    parser.add_argument(
        "--access-key",
        default=os.environ.get("LAKEHOUSE_MINIO_ACCESS_KEY", "minioadmin"),
        help="MinIO access key (default: env or minioadmin)",
    )
    parser.add_argument(
        "--secret-key",
        default=os.environ.get("LAKEHOUSE_MINIO_SECRET_KEY", "minioadmin"),
        help="MinIO secret key (default: env or minioadmin)",
    )
    parser.add_argument(
        "--region",
        default=os.environ.get("LAKEHOUSE_MINIO_REGION", "us-east-1"),
        help="S3 region (default: %(default)s)",
    )
    parser.add_argument(
        "--allow-non-local-endpoint",
        action="store_true",
        help="explicitly allow a non-loopback endpoint",
    )
    return parser.parse_args()


def require_pinned_packages() -> dict[str, str]:
    actual: dict[str, str] = {}
    mismatches: list[str] = []
    for package, expected in PINNED_PACKAGES.items():
        try:
            installed = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            mismatches.append(f"{package}: missing (expected {expected})")
            continue
        actual[package] = installed
        if installed != expected:
            mismatches.append(f"{package}: {installed} (expected {expected})")
    if mismatches:
        raise RuntimeError(
            "fixture generator dependencies do not match "
            "requirements-regenerate.txt:\n  " + "\n  ".join(mismatches)
        )
    return actual


def validate_endpoint(endpoint: str, allow_non_local: bool) -> tuple[str, str]:
    parsed = urlparse(endpoint)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.params
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("endpoint must be an origin such as http://127.0.0.1:19000")

    try:
        is_loopback = ipaddress.ip_address(parsed.hostname).is_loopback
    except ValueError:
        is_loopback = parsed.hostname == "localhost"
    if not is_loopback and not allow_non_local:
        raise ValueError(
            "refusing a non-loopback object store; pass "
            "--allow-non-local-endpoint only for a disposable endpoint"
        )

    return parsed.scheme, parsed.netloc


def empty_fixture_filesystem(
    endpoint: str,
    access_key: str,
    secret_key: str,
    region: str,
    allow_non_local: bool,
) -> Any:
    import pyarrow.fs as arrow_fs

    scheme, endpoint_override = validate_endpoint(endpoint, allow_non_local)
    filesystem = arrow_fs.S3FileSystem(
        access_key=access_key,
        secret_key=secret_key,
        region=region,
        scheme=scheme,
        endpoint_override=endpoint_override,
        force_virtual_addressing=False,
        allow_bucket_creation=True,
    )
    bucket_info = filesystem.get_file_info(BUCKET)
    if bucket_info.type == arrow_fs.FileType.NotFound:
        filesystem.create_dir(BUCKET)
    elif bucket_info.type != arrow_fs.FileType.Directory:
        raise RuntimeError(f"{BUCKET} exists but is not a bucket")

    existing = filesystem.get_file_info(
        arrow_fs.FileSelector(BUCKET, recursive=True, allow_not_found=True)
    )
    if existing:
        raise RuntimeError(
            f"s3://{BUCKET} is not empty; use a fresh disposable MinIO instance"
        )
    return filesystem


def normalized_rows(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    return sorted(rows, key=lambda row: (int(row["id"]), str(row["value"])))


def expected_rows(commit: int) -> list[dict[str, object]]:
    return normalized_rows(list(ROWS[:commit]))


def generate_iceberg(
    stage: Path,
    endpoint: str,
    access_key: str,
    secret_key: str,
    region: str,
) -> tuple[str, list[str]]:
    import pyarrow as pa
    from pyiceberg.catalog import load_catalog

    catalog = load_catalog(
        "lakehouse-fixture-generator",
        **{
            "type": "sql",
            "uri": f"sqlite:///{stage / 'iceberg-catalog.db'}",
            "warehouse": f"s3://{BUCKET}/{ICEBERG_PREFIX}",
            "py-io-impl": "pyiceberg.io.pyarrow.PyArrowFileIO",
            "s3.endpoint": endpoint,
            "s3.access-key-id": access_key,
            "s3.secret-access-key": secret_key,
            "s3.region": region,
        },
    )
    catalog.create_namespace("default")
    schema = pa.schema(
        [
            pa.field("id", pa.int64(), nullable=True),
            pa.field("value", pa.string(), nullable=True),
        ]
    )
    table = catalog.create_table(ICEBERG_TABLE, schema=schema)
    for row in ROWS:
        table.append(
            pa.table(
                {"id": [row["id"]], "value": [row["value"]]},
                schema=schema,
            )
        )

    snapshots = table.snapshots()
    if len(snapshots) != len(ROWS):
        raise RuntimeError(f"Iceberg history has {len(snapshots)} snapshots")
    for commit, snapshot in enumerate(snapshots, start=1):
        actual = normalized_rows(
            table.scan(snapshot_id=snapshot.snapshot_id).to_arrow().to_pylist()
        )
        if actual != expected_rows(commit):
            raise RuntimeError(f"Iceberg snapshot {commit} has unexpected rows")

    metadata_uri = table.metadata_location
    expected_prefix = f"s3://{BUCKET}/"
    if not metadata_uri.startswith(expected_prefix):
        raise RuntimeError(f"unexpected Iceberg metadata URI: {metadata_uri}")
    return (
        metadata_uri.removeprefix(expected_prefix),
        [str(snapshot.snapshot_id) for snapshot in snapshots],
    )


def generate_delta(destination: Path) -> None:
    import pyarrow as pa
    from deltalake import DeltaTable, write_deltalake

    schema = pa.schema(
        [
            pa.field("id", pa.int64(), nullable=True),
            pa.field("value", pa.string(), nullable=True),
        ]
    )
    for commit, row in enumerate(ROWS, start=1):
        write_deltalake(
            str(destination),
            pa.table(
                {"id": [row["id"]], "value": [row["value"]]},
                schema=schema,
            ),
            mode="overwrite" if commit == 1 else "append",
        )

    for version in range(len(ROWS)):
        actual = normalized_rows(
            DeltaTable(str(destination), version=version)
            .to_pyarrow_table()
            .to_pylist()
        )
        if actual != expected_rows(version + 1):
            raise RuntimeError(f"Delta version {version} has unexpected rows")


def download_iceberg(filesystem: Any, destination: Path) -> None:
    import pyarrow.fs as arrow_fs

    prefix = f"{BUCKET}/{ICEBERG_PREFIX}"
    infos = filesystem.get_file_info(
        arrow_fs.FileSelector(prefix, recursive=True, allow_not_found=False)
    )
    files = [info for info in infos if info.type == arrow_fs.FileType.File]
    if not files:
        raise RuntimeError("Iceberg generation produced no object files")

    for info in files:
        relative = PurePosixPath(info.path).relative_to(BUCKET)
        output = destination / Path(*relative.parts)
        output.parent.mkdir(parents=True, exist_ok=True)
        with filesystem.open_input_file(info.path) as source, output.open("wb") as sink:
            shutil.copyfileobj(source, sink)


def write_manifest(
    destination: Path,
    metadata_key: str,
    snapshot_ids: list[str],
    package_versions: dict[str, str],
) -> None:
    manifest = {
        "schemaVersion": 1,
        "rowsByCommit": [list(ROWS[:commit]) for commit in range(1, len(ROWS) + 1)],
        "iceberg": {
            "currentMetadataKey": metadata_key,
            "snapshotIds": snapshot_ids,
        },
        "delta": {
            "versions": list(range(len(ROWS))),
        },
        "generator": {
            "packages": package_versions,
        },
    }
    (destination / "fixture-manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def generate(args: argparse.Namespace) -> Path:
    output = args.output.expanduser().resolve()
    if output.exists():
        raise FileExistsError(f"output already exists: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)

    validate_endpoint(args.endpoint, args.allow_non_local_endpoint)
    package_versions = require_pinned_packages()

    filesystem = empty_fixture_filesystem(
        args.endpoint,
        args.access_key,
        args.secret_key,
        args.region,
        args.allow_non_local_endpoint,
    )

    with tempfile.TemporaryDirectory(
        prefix=f".{output.name}.", dir=output.parent
    ) as temporary:
        stage = Path(temporary)
        fixture = stage / "lakehouse"
        fixture.mkdir()
        metadata_key, snapshot_ids = generate_iceberg(
            stage,
            args.endpoint,
            args.access_key,
            args.secret_key,
            args.region,
        )
        download_iceberg(filesystem, fixture)
        generate_delta(fixture / "delta-events")
        write_manifest(fixture, metadata_key, snapshot_ids, package_versions)
        fixture.replace(output)
    return output


def main() -> int:
    args = parse_args()
    try:
        output = generate(args)
    except (FileExistsError, RuntimeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(f"Generated and verified Lakehouse fixtures at {output}")
    print(f"Metadata pointer: {output / 'fixture-manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
