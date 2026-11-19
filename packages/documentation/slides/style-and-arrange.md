---
title: Style and arrange objects
description: Change how shapes, images, and text boxes look, and place, align, group, and order them on a slide.
type: how-to
---

# Style and arrange objects

Change the fill, border, and effects of objects on a slide, and place them exactly where you want them.

::: info Before you start
- You need edit access. A share-link viewer can't change the deck.
- On a phone, styling controls are in the **Format** sheet. See [On a phone](#on-a-phone).
:::

## Select objects

- Click an object to select it. Hold `Shift` and click to add or remove objects.
- Drag across an empty part of the slide to select every object the box touches.
- Press `⌘+A` / `Ctrl+A` to select everything on the slide, and `Tab` to step through objects one at a time.

To select one object inside a group, double-click it. Press `Escape` to step back out to the whole group.

## Change the fill

1. Select a shape or text box.
2. Click **Fill color** in the toolbar.
3. Choose a theme color, a standard color, or a custom color. Use the **Transparency** slider to make it see-through. For a shape, these are on the **Solid** tab.

Theme colors follow the deck: if you later switch themes, the object switches color with it.

### Use a gradient

1. Select a shape and click **Fill color**.
2. Click the **Gradient** tab.
3. Click the stops bar to add a stop, drag a stop to move it, and select a stop to change its color or **Position**. Click **Delete stop** to remove the selected one.
4. Choose one of the eight direction arrows, or type an **Angle**.

Gradients are linear and are available for shapes only.

## Change the border

1. Select a shape, text box, or line.
2. Use the border controls in the toolbar:
   - **Border color** sets the color.
   - **Border weight** sets the thickness, from **No border** to 16 px.
   - **Border dash** sets solid, dashed, or dotted.

## Copy formatting to another object

1. Select one shape, text box, or line.
2. Click **Format painter** (the brush icon) in the toolbar.
3. Click the object you want to change.

The fill and border copy once, then the painter turns off. To cancel before you click, press `Escape` or click **Format painter** again.

## Crop an image

1. Double-click the image, or select it and click **Crop** in the toolbar.
2. Drag the black handles to trim the edges. Drag inside the crop window to move the picture under it.
3. Press `Enter`, click **Done cropping**, or click outside the image to apply. Press `Escape` to cancel.

To return to the full picture, select the image and click **Reset crop**. It is unavailable until the image has been cropped.

![Image in crop mode with the area outside the crop window dimmed and eight black handles](/images/slides/style-and-arrange-crop.png)

## Use the Format options panel

1. Select an object. With nothing selected, the panel shows the deck's slide size.
2. Click **Format** at the right end of the toolbar (on a narrow window, the icon with the tooltip **Format options**).
3. Change the values. To add a **Drop shadow** or **Reflection**, select its checkbox to show its settings.

The panel shows only the sections that apply to what you selected:

| Section | Appears for | Settings |
|---|---|---|
| **Size & Position** | Every object | Width, Height, X position, Y position, Rotation, **Lock aspect ratio**, 90° rotate buttons, and **Units** (Inches or Centimeters) |
| **Text fitting** | Text boxes | **Do not autofit**, **Shrink text on overflow**, or **Resize shape to fit text** |
| **Recolor** | Images | **No recolor**, **Grayscale**, or **Sepia** |
| **Adjustments** | Images | Transparency, Brightness, Contrast |
| **Drop shadow** | Shapes, images, text boxes | Color, Transparency, Angle, Distance, Blur |
| **Reflection** | Shapes, images, text boxes | Transparency, Distance, Size |
| **Alt text** | Shapes, images, text boxes, tables | A description for screen readers |

Lines, groups, and mixed selections show **Size & Position** only. Lines and mixed selections have no Width, Height, or Rotation. A text box set to **Resize shape to fit text** has its Height locked, because the text sets it. **Units** applies to the whole deck and also sets the rulers.

### Change the slide size

1. Click an empty part of the slide so nothing is selected.
2. In the Format options panel, choose **Widescreen 16:9**, **Standard 4:3**, or **Widescreen 16:10**.

To use another shape, type a **Height**. Width stays fixed, and the preset reads **Custom**.

## Align and distribute objects

1. Select the objects. With one object selected, it aligns to the slide.
2. Click **Arrange** (the stacked-layers icon) in the toolbar.
3. Select **Align** and choose **Left**, **Center**, **Right**, **Top**, **Middle**, or **Bottom**.

To even out the gaps, select three or more objects and choose **Arrange > Distribute > Horizontally** or **Vertically**. The outermost two stay put.

## Change the stacking order

1. Select an object.
2. Choose **Arrange > Order** and select **Bring to front**, **Bring forward**, **Send backward**, or **Send to back**.

You can also right-click the object for the same items.

## Group and ungroup objects

1. Select two or more objects.
2. Choose **Arrange > Group**, or press `⌘+Option+G` / `Ctrl+Alt+G`.

To break a group apart, select it and choose **Arrange > Ungroup**.

## Rotate an object

- Drag the handle above the object. Hold `Shift` to snap to 15° steps.
- Or choose **Arrange > Rotate 90° clockwise** or **Rotate 90° counter-clockwise**.

## Place objects precisely

- Press the arrow keys to nudge the selection by 1 px, or `Shift` plus an arrow key for 10 px.
- Hold `Shift` while dragging to move along one axis only.
- Hold `Shift` while resizing to keep the proportions.

As you drag, objects snap to the slide center, to guides, and to the edges of other objects. Red guides appear when gaps or sizes match a nearby object. Snapping and these guides are always on.

### Add a guide

1. Press on the ruler along the top or left of the slide.
2. Drag onto the slide and release.

Drag a guide to move it, or drag it back onto the ruler to delete it. Right-click a guide for **Delete guide**, **Delete all vertical guides** or **Delete all horizontal guides**, and **Delete all guides**. Guides apply to every slide in the deck.

## On a phone

- Select an object, then tap **Format** in the toolbar for its fill, border, and image controls.
- Tap **Arrange** (the stacked-layers icon) for align, order, group, and rotate.
- For the Format options panel, tap **More slide options** (⋮) and select **Format options…**. It opens as a sheet.

## Known limitations

- The format painter has no stay-on mode and no shortcut. It can't copy from an image, and lines copy only onto other lines.
- Painting a gradient onto a text box keeps one solid color.
- Crop is a free rectangle. There are no aspect-ratio presets or crop-to-shape.
- Images inside a group can't be cropped. Ungroup them first.

## Related

- [Add content](/slides/add-content) to insert shapes, images, and tables.
- [Themes and layouts](/slides/themes-and-layouts) to change the colors that theme fills use.
- [Keyboard shortcuts](/slides/keyboard-shortcuts) for selection, nudge, and order shortcuts.
