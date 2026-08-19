# Lessons — canvas scenes (PR 12b)

## Re-probe an inherited measurement when its subject moved

The shim's entire design rests on a probe against `@yorkie-js/sdk@0.7.13`; the repo is on
0.7.16. Every claim still held, but that was worth ten minutes to establish rather than
assume — and it is the same rule that has already corrected three other inherited numbers in
this series.

## Reading a screen too early reports a failure that is not there

I recorded four canvas scenes as "stuck on Loading…" from a probe that sampled at the first
non-empty `innerHTML`. The shell paints before the engine mounts, so that snapshot catches a
title placeholder on a scene that renders perfectly. A settle loop — wait for the text to
stop changing — was the whole fix, and the gate now also fails on a lingering `Loading...` so
the mistake cannot come back as a green check.

## Canvas content cannot be verified through the DOM

A sheet and a docs page paint on `<canvas>`, so the browser gate can prove the scene mounts
and shows its title and nothing more. Testing the seed functions directly against a detached
`Document` is both precise and free, and it is where the interesting assertions live (`{v,f}`
never `{f}` alone; a Text edited rather than replaced). Reach for the cheap exact test before
the expensive approximate one.

## `in` is not how you ask a Yorkie object what it holds

`'f' in cell` is `false` for a cell whose JSON is `{"v":…,"f":…}`. The proxy implements no
`has` trap. My test failed and my first instinct was that the seed was wrong; the probe said
otherwise. Two minutes of looking beat any amount of reasoning about which was broken.
