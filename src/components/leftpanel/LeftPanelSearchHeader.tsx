import EwrSelectCompat from "../inputs/EwrSelectCompat";

export type SortOption<T extends string> = { value: T; label: string };

export type LeftPanelSearchHeaderProps<T extends string> = {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;

  // Sorting is optional (some editors don't expose a sort dropdown).
  sortValue?: T;
  onSortChange?: (value: T) => void;
  sortOptions?: SortOption<T>[];

  // Counts are optional; when omitted we hide the "Showing X of Y" line.
  showingCount?: number;
  totalCount?: number;

  // Filters toggle is optional; when omitted we hide the filters row.
  filtersOpen?: boolean;
  onToggleFilters?: () => void;
  activeFilterCount?: number;

  onClearFilters?: () => void;
  clearFiltersDisabled?: boolean;
};

export default function LeftPanelSearchHeader<T extends string>(props: LeftPanelSearchHeaderProps<T>) {
  const activeCount = props.activeFilterCount ?? 0;
  const sortOptions = props.sortOptions ?? [];
  const showSort = !!props.onSortChange && !!props.sortValue && sortOptions.length > 0;
  const showCounts = typeof props.showingCount === "number" && typeof props.totalCount === "number";
  const showFilters = !!props.onToggleFilters && typeof props.filtersOpen === "boolean";
  return (
    <>
      <div className="ewr-leftSearchRow">
        <input
          className="ewr-input"
          value={props.search}
          onChange={(e) => props.onSearchChange(e.target.value)}
          placeholder={props.searchPlaceholder ?? "Search"}
        />
        {showSort ? (
          <EwrSelectCompat
            className="ewr-input"
            value={props.sortValue}
            onChange={(e) => props.onSortChange?.(e.target.value as T)}
            style={{ width: 150 }}
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </EwrSelectCompat>
        ) : null}
      </div>

      {showCounts ? (
        <div className="ewr-muted" style={{ marginTop: 12 }}>
          Showing <span className="ewr-strong">{props.showingCount}</span> of{" "}
          <span className="ewr-strong">{props.totalCount}</span>
        </div>
      ) : null}

      {showFilters ? (
        <div className="ewr-filterToggleRow">
          <button
            type="button"
            className="ewr-button ewr-buttonSmall ewr-filterToggleBtn"
            onClick={props.onToggleFilters}
          >
            {props.filtersOpen ? "Hide Filters" : "Filters"}
            {activeCount ? ` (${activeCount})` : ""}
          </button>

          <div className="ewr-filterToggleActions">
            {props.onClearFilters ? (
              <button
                type="button"
                className="ewr-button ewr-buttonSmall"
                onClick={props.onClearFilters}
                disabled={!!props.clearFiltersDisabled}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
