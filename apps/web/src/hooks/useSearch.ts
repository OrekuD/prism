import React from "react";

/**
 * Effect hook for handling search
 * @param query Search query
 * @param minCharactersCallback What to do when query has less than 3 chars (eg. Disable loading indicators)
 * @param searchFunction Callback containing search logic
 */
export function useSearch(
  query: string,
  minCharactersCallback: () => void,
  searchFunction: (...args: any[]) => void,
) {
  React.useEffect(() => {
    if (query.length < 3) {
      // Disable loading indicators here
      minCharactersCallback();
      return;
    }

    const timeoutHandle = setTimeout(() => {
      searchFunction();
    }, 500);

    return () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    };
  }, [query]);
}
