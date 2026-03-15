// Simple wrapper around window.alert/window.confirm to force a consistent
// dialog title. (Browser dialogs use document.title as the title.)

function withTempTitle<T>(title: string, fn: () => T): T {
  const prev = document.title;
  document.title = title;
  try {
    return fn();
  } finally {
    document.title = prev;
  }
}

export function alertWarning(message: string) {
  return withTempTitle("WARNING", () => window.alert(message));
}

export function confirmWarning(message: string) {
  return withTempTitle("WARNING", () => window.confirm(message));
}
