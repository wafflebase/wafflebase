import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GenericFileView } from "@/app/files/generic-file-view";

describe("GenericFileView", () => {
  it("shows the extension, name and size", () => {
    render(
      <GenericFileView
        title="quarterly-report"
        fileId="11111111-2222-3333-4444-555555555555.zip"
        fileSize={2048}
      />,
    );
    // No @testing-library/jest-dom in this repo (not installed anywhere in
    // the monorepo) — getByText already throws if no match is found, so
    // toBeTruthy() gives the same assertion strength as toBeInTheDocument().
    expect(screen.getByText("quarterly-report")).toBeTruthy();
    expect(screen.getByText("ZIP")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
  });

  it("degrades when there is no extension or size", () => {
    render(
      <GenericFileView
        title="Makefile"
        fileId="11111111-2222-3333-4444-555555555555"
      />,
    );
    expect(screen.getByText("Makefile")).toBeTruthy();
    expect(screen.getByText("FILE")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });
});
