```css
.button {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-md);
  background: var(--color-button-primary-bg);
  color: var(--color-button-primary-fg);
  border-radius: var(--radius-md);
}

.button__label {
  color: var(--color-button-primary-fg);
  font-family: var(--typo-label-md-font-family);
  font-size: var(--typo-label-md-font-size);
  font-weight: var(--typo-label-md-font-weight);
  line-height: var(--typo-label-md-line-height);
}

.button--variant-primary {
  background: var(--color-button-primary-bg);
}

.button--variant-secondary {
  background: var(--color-button-primary-bg);
}

.button--size-md {
  background: var(--color-button-primary-bg);
}
```

```html
<div class="button button--variant-primary button--size-md" data-variant="variant=primary,size=md">
  <span class="button__label">Button</span>
</div>
<div class="button button--variant-secondary button--size-md" data-variant="variant=secondary,size=md">
  <span class="button__label">Button</span>
</div>
```
