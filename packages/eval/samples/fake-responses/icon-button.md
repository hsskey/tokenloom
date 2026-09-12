```css
.iconbutton {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-md);
  background: var(--color-action-bg);
  color: var(--color-action-fg);
  border-radius: var(--radius-md);
}

.iconbutton__label {
  color: var(--color-action-fg);
  font-family: var(--typo-label-md-font-family);
  font-size: var(--typo-label-md-font-size);
  font-weight: var(--typo-label-md-font-weight);
  line-height: var(--typo-label-md-line-height);
}

.iconbutton--size-sm {
  background: var(--color-action-bg);
}

.iconbutton--size-md {
  background: var(--color-action-bg);
}

.iconbutton--size-lg {
  background: var(--color-action-bg);
}

.iconbutton--state-default {
  background: var(--color-action-bg);
}

.iconbutton--state-hover {
  background: var(--color-action-bg);
}

.iconbutton--state-disabled {
  background: var(--color-action-bg);
}
```

```html
<div class="iconbutton iconbutton--size-sm iconbutton--state-default" data-variant="size=sm,state=default">
  <span class="iconbutton__label">IconButton</span>
</div>
<div class="iconbutton iconbutton--size-sm iconbutton--state-hover" data-variant="size=sm,state=hover">
  <span class="iconbutton__label">IconButton</span>
</div>
<div class="iconbutton iconbutton--size-sm iconbutton--state-disabled" data-variant="size=sm,state=disabled">
  <span class="iconbutton__label">IconButton</span>
</div>
<div class="iconbutton iconbutton--size-md iconbutton--state-default" data-variant="size=md,state=default">
  <span class="iconbutton__label">IconButton</span>
</div>
<div class="iconbutton iconbutton--size-md iconbutton--state-hover" data-variant="size=md,state=hover">
  <span class="iconbutton__label">IconButton</span>
</div>
<div class="iconbutton iconbutton--size-md iconbutton--state-disabled" data-variant="size=md,state=disabled">
  <span class="iconbutton__label">IconButton</span>
</div>
<div class="iconbutton iconbutton--size-lg iconbutton--state-default" data-variant="size=lg,state=default">
  <span class="iconbutton__label">IconButton</span>
</div>
<div class="iconbutton iconbutton--size-lg iconbutton--state-hover" data-variant="size=lg,state=hover">
  <span class="iconbutton__label">IconButton</span>
</div>
<div class="iconbutton iconbutton--size-lg iconbutton--state-disabled" data-variant="size=lg,state=disabled">
  <span class="iconbutton__label">IconButton</span>
</div>
```
