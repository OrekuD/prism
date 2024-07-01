import { LocalStorageKeys } from "@/constants/LocalStorageKeys";

export function clearLocalStorage() {
  const valueToKeep = localStorage.getItem(LocalStorageKeys.THEME_VALUE);
  localStorage.clear();
  if (valueToKeep !== null) {
    localStorage.setItem(LocalStorageKeys.THEME_VALUE, valueToKeep);
  }
}
