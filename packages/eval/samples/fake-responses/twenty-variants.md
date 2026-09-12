```css
.chip {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-md);
  background: var(--color-action-bg);
  color: var(--color-surface-fg);
  border-radius: var(--radius-md);
}

.chip__label {
  color: var(--color-surface-fg);
  font-family: var(--typo-label-md-font-family);
  font-size: var(--typo-label-md-font-size);
  font-weight: var(--typo-label-md-font-weight);
  line-height: var(--typo-label-md-line-height);
}

.chip--size-xs {
  background: var(--color-action-bg);
}

.chip--size-sm {
  background: var(--color-action-bg);
}

.chip--size-md {
  background: var(--color-action-bg);
}

.chip--size-lg {
  background: var(--color-action-bg);
}

.chip--state-default {
  background: var(--color-action-bg);
}

.chip--state-hover {
  background: var(--color-action-bg);
}

.chip--state-pressed {
  background: var(--color-action-bg);
}

.chip--state-selected {
  background: var(--color-action-bg);
}

.chip--state-disabled {
  background: var(--color-action-bg);
}
```

```html
<div class="chip chip--size-xs chip--state-default" data-variant="size=xs,state=default">
  <span class="chip__label">Chip</span>
</div>
<div class="chip chip--size-xs chip--state-hover" data-variant="size=xs,state=hover">
  <span class="chip__label">Chip</span>
</div>
<div class="chip chip--size-xs chip--state-pressed" data-variant="size=xs,state=pressed">
  <span class="chip__label">Chip</span>
</div>
<div class="chip chip--size-xs chip--state-selected" data-variant="size=xs,state=selected">
  <span class="chip__label">Chip</span>
</div>
<div class="chip chip--size-xs chip--state-disabled" data-variant="size=xs,state=disabled">
  <span class="chip__label">Chip</span>
</div>
<div class="chip chip--size-sm chip--state-default" data-variant="size=sm,state=default">
  <span class="chip__label">Chip</span>
</div>
<div class="chip chip--size-sm chip--state-hover" data-variant="size=sm,state=hover">
  <span class="chip__label">Chip</span>
</div>
<div class="chip chip--size-sm chip--state-pressed" data-variant="size=sm,state=pressed">
  <span class="chip__label">Chip</span>
</div>
<div class="chip chip--size-sm chip--state-selected" data-variant="size=sm,state=selected">
  <span class="chip__label">Chip</span>
</div>
<div class="chip chip--size-sm chip--state-disabled" data-variant="size=sm,state=disabled">
  <span class="chip__label">Chip</span>
</div>
<div class="chip chip--size-md chip--state-default" data-variant="size=md,state=default">
  <span class="chip__label">Chip</span>
</div>
<div class="chip chip--size-md chip--state-hover" data-variant="size=md,state=hover">
  <span class="chip__label">Chip</span>
</div>
<div class="chip chip--size-md chip--state-pressed" data-variant="size=md,state=pressed">
  <span class="chip__label">Chip</span>
</div>
<div class="chip chip--size-md chip--state-selected" data-variant="size=md,state=selected">
  <span class="chip__label">Chip</span>
</div>
<div class="chip chip--size-md chip--state-disabled" data-variant="size=md,state=disabled">
  <span class="chip__label">Chip</span>
</div>
<div class="chip chip--size-lg chip--state-default" data-variant="size=lg,state=default">
  <span class="chip__label">Chip</span>
</div>
<div class="chip chip--size-lg chip--state-hover" data-variant="size=lg,state=hover">
  <span class="chip__label">Chip</span>
</div>
<div class="chip chip--size-lg chip--state-pressed" data-variant="size=lg,state=pressed">
  <span class="chip__label">Chip</span>
</div>
<div class="chip chip--size-lg chip--state-selected" data-variant="size=lg,state=selected">
  <span class="chip__label">Chip</span>
</div>
<div class="chip chip--size-lg chip--state-disabled" data-variant="size=lg,state=disabled">
  <span class="chip__label">Chip</span>
</div>
```
