---
title: Add animations and transitions
description: Add slide transitions and object animations to a deck, set their timing, and preview them in the editor.
type: how-to
---

# Add animations and transitions

Add a transition that plays when a slide appears, and animations that bring objects onto a slide, take them off, or draw attention to them.

Transitions and animations play when you [present the deck](/slides/present). Both are set in the **Motion** panel.

::: info Before you start
- You need edit access. A share-link viewer can't change motion.
- On a phone, open the panel from **More slide options** (⋮) **> Motion…**.
:::

## Add a slide transition

1. Open the slide.
2. Click **Motion** at the right end of the toolbar. The **Motion** panel opens.
3. Under **Transition**, choose a **Type**: **Fade**, **Dissolve**, **Slide**, **Flip**, **Cube**, **Wipe**, or **Push**.
4. Choose a **Speed**: **Slow**, **Medium**, or **Fast**.

To use the same transition on every slide, click **Apply to all slides**. To remove a transition, set **Type** to **None**.

## Animate an object

1. Select the object on the slide.
2. In the **Motion** panel, under **Animation**, click **+ Add animation**. A new animation is added with **Entrance**, **Fade In**, and **On Click**.
3. Set **Category** and **Effect** (see [Effects](#effects)).
4. Set **Start**:
   - **On Click** waits for the next click or key press.
   - **With Previous** plays at the same time as the animation before it.
   - **After Previous** plays when the animation before it ends.
5. Adjust **Duration**, **Delay** (in milliseconds), and **Easing**.

For **Fly In** and **Fly Out**, a **Direction** setting appears: **From Top**, **From Bottom**, **From Left**, or **From Right**. For a text box, select **By paragraph** to animate one paragraph at a time.

**+ Add animation** is unavailable until you select an object.

![Motion panel with a Fade transition and two animations, the second set to Fly In from the left](/images/slides/animations-motion-panel.png)

## Reorder or remove animations

Animations play in list order. On an animation in the list:

- Click **Move up** (↑) or **Move down** (↓) to change its place.
- Click **Remove animation** (×) to delete it.

## Preview animations

Click **Preview animations** (▶) next to **+ Add animation**. The current slide's animations play on the canvas. The button is unavailable until the slide has at least one animation.

## Effects

| Category | Effects |
|---|---|
| Entrance | Appear, Fade In, Fly In, Zoom In, Spin |
| Exit | Disappear, Fade Out, Fly Out, Zoom Out |
| Emphasis | Pulse, Grow |

**Easing** options are **Linear**, **Ease In**, **Ease Out**, and **Ease In Out**. **Duration** ranges from 100 to 3,000 milliseconds.

## Known limitations

- If your computer or browser is set to reduce motion, transitions become instant cuts and animated objects appear in their final state.
- A transition's speed has three presets. You can't type a custom length.

## Related

- [Present](/slides/present) to play the deck with its transitions and animations.
- [Style and arrange](/slides/style-and-arrange) to group objects so they animate together.
- [Keyboard shortcuts](/slides/keyboard-shortcuts) for moving through a slideshow.
