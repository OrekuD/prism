export function getInitials(fullName: string): string {
  const names = fullName.split(" ");

  if (names.length === 1) {
    return names[0].substring(0, 2).toUpperCase();
  }

  const firstInitial = names[0][0];

  const lastInitial = names[names.length - 1][0];

  return (firstInitial + lastInitial).toUpperCase();
}
