export function swallow(run: () => void): void {
  try {
    run();
  } catch (error) {}
}
