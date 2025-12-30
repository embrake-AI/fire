# Dashboard Service

SolidJS dashboard with Vite, TanStack Router, and TanStack Query.

## Package Management

This monorepo uses **bun**. Run commands from the monorepo root or this directory:

```bash
bun run dev        # Start dev server on port 3000
bun run build      # Build for production
bun run preview    # Preview production build
bun run test       # Run tests with vitest
bun run type-check # TypeScript type checking
bun run lint       # Run biome linter
```

## Static Shell + Suspense Pattern

Use this pattern for pages that fetch data: render static UI immediately while data-dependent content suspends.

### Structure

```tsx
// Route points directly to component (no Suspense wrapper)
export const Route = createFileRoute('/_authed/my-page')({
    component: MyPage,
})

// Static shell renders immediately
function MyPage() {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Page Title</CardTitle> {/* Static - renders immediately */}
            </CardHeader>
            <Suspense fallback={<ContentSkeleton />}>
                <PageContent /> {/* Data-dependent - suspends */}
            </Suspense>
        </Card>
    )
}

// Data fetching happens in the content component
function PageContent() {
    const query = useQuery(() => ({
        queryKey: ['data'],
        queryFn: fetchData,
    }))

    return <CardContent>{/* Render query.data */}</CardContent>
}

// Skeleton matches content structure (not the full page)
function ContentSkeleton() {
    return (
        <CardContent>
            <Skeleton class="h-10 w-36" />
        </CardContent>
    )
}
```

### Key Principles

1. **Static shell renders immediately**: Headers, navigation, card containers, page layout
2. **Suspense wraps only data-dependent content**: The component that calls `useQuery`
3. **Skeleton matches content structure**: Don't duplicate static elements in skeleton

### Animation Guidelines

**Do NOT use `animate-in fade-in` anywhere in data-fetching routes**

These animations cause flickering on every refetch, even when the DOM doesn't change. The animation class re-triggers whenever the component re-renders. This applies to:

- Data content components
- Skeleton/loading fallbacks (they re-render on refetch too!)
- Any component inside a Suspense boundary

**Where animations ARE appropriate:**

- UI components (popovers, tooltips, selects - visibility changes via `fade-in-0`)
- One-time app shell transitions (e.g., after auth is ready)

### When to Use Suspense vs Show

| Use Case                             | Tool         |
| ------------------------------------ | ------------ |
| Data fetching with tanstack query    | `<Suspense>` |
| Conditional rendering based on state | `<Show>`     |
| Toggle visibility based on signals   | `<Show>`     |

### Skeleton Component

Use the `Skeleton` component from `~/components/ui/skeleton`:

```tsx
import { Skeleton } from "~/components/ui/skeleton";

// Variants
<Skeleton class="h-10 w-36" />                    // rectangular (default)
<Skeleton variant="text" class="h-4 w-24" />      // text line
<Skeleton variant="circular" class="w-8 h-8" />   // avatar/icon
```

---

## Queries in Dialogs Pattern

When using TanStack Query with Suspense enabled globally, queries in dialogs can accidentally trigger parent Suspense boundaries even when the dialog is closed.

### The Problem

```tsx
// BAD: Query exists even when dialog is closed
function MyDialog() {
    const [open, setOpen] = createSignal(false)

    // This query is created immediately, not just when dialog opens
    const dataQuery = useQuery(() => ({
        queryKey: ['data'],
        queryFn: fetchData,
        enabled: open(), // enabled:false doesn't prevent Suspense evaluation!
    }))

    // This memo can trigger suspension even when open() is false
    // because accessing query.data evaluates the reactive graph
    const derived = createMemo(() => open() && dataQuery.data?.someField)

    return (
        <Dialog open={open()} onOpenChange={setOpen}>
            <DialogContent>...</DialogContent>
        </Dialog>
    )
}
```

The `enabled: false` option prevents fetching but does NOT prevent the query from participating in Suspense. Any reactive access to query data (even guarded by `open()`) can trigger parent Suspense boundaries.

### The Solution

Move queries into a subcomponent that only renders when the dialog is open:

```tsx
// GOOD: Queries only exist when dialog content renders
function MyDialog() {
    const [open, setOpen] = createSignal(false)

    return (
        <Dialog open={open()} onOpenChange={setOpen}>
            <DialogTrigger>Open</DialogTrigger>
            <Show when={open()}>
                <MyDialogContent onClose={() => setOpen(false)} />
            </Show>
        </Dialog>
    )
}

// Queries live here - component only mounts when dialog is open
function MyDialogContent(props: { onClose: () => void }) {
    // Now safe - query only exists when dialog is visible
    const dataQuery = useQuery(() => ({
        queryKey: ['data'],
        queryFn: fetchData,
    }))

    // Safe to derive from query data
    const derived = () => dataQuery.data?.someField

    return <DialogContent>...</DialogContent>
}
```

### Key Points

1. **Wrap dialog content in `<Show when={open()}>`** to defer component creation
2. **Move all queries to the inner component** that only renders when open
3. **No need for `enabled` or `suspense: false`** - component lifecycle handles it
4. **Pass `onClose` callback** instead of sharing signal setters
5. **State resets naturally** when dialog closes (component unmounts)

---

## Config Pages UI Consistency

All configuration pages under `src/routes/_authed.config.*.tsx` share a consistent card-based UI pattern.

### Page Structure

Each config page follows this structure:

```tsx
function ConfigPage() {
    return (
        <Card class="p-6">
            <Suspense fallback={<ContentSkeleton />}>
                <Content />
            </Suspense>
        </Card>
    )
}
```

The content area contains:

1. An action button (e.g., "Create Rotation", "Create Entry Point")
2. A list of `ConfigCard` items or an empty state
3. Any dialogs/modals for creation flows

### ConfigCard Components

Use components from `~/components/ui/config-card`:

| Component                   | Purpose                                           |
| --------------------------- | ------------------------------------------------- |
| `ConfigCard`                | Wrapper with `isActive` and `hasWarning` states   |
| `ConfigCardRow`             | Clickable row with `onClick` for expandable cards |
| `ConfigCardIcon`            | Colored circular icon (always use `size="sm"`)    |
| `ConfigCardTitle`           | Item name/title                                   |
| `ConfigCardActions`         | Action buttons container with `animated` prop     |
| `ConfigCardDeleteButton`    | Trash button with loading state                   |
| `ConfigCardExpandedContent` | Content shown when card is expanded               |

### Card Layout Pattern

All cards use a single-line layout with consistent structure:

```tsx
<ConfigCard isActive={isExpanded()}>
  <ConfigCardRow onClick={handleToggle}>
    {/* Left: Icon + Title + Badge */}
    <ConfigCardIcon variant="violet" size="sm">
      <Icon class="w-4 h-4" />
    </ConfigCardIcon>
    <span class="flex items-center gap-2">
      <ConfigCardTitle class="shrink-0">{name}</ConfigCardTitle>
      <Badge variant="outline" class="font-normal text-xs">...</Badge>
    </span>

    {/* Spacer */}
    <span class="flex-1" />

    {/* Right: Status + Actions + Chevron */}
    <span class="flex items-center gap-3 shrink-0">
      <span class="text-sm text-muted-foreground">Status text</span>
      <ConfigCardActions animated alwaysVisible={isExpanded()}>
        <ConfigCardDeleteButton onDelete={...} isDeleting={...} alwaysVisible />
      </ConfigCardActions>
      <Show when={isExpanded()} fallback={<ChevronDown class="w-4 h-4 text-muted-foreground" />}>
        <ChevronUp class="w-4 h-4 text-muted-foreground" />
      </Show>
    </span>
  </ConfigCardRow>
</ConfigCard>
```

### Key Patterns

#### Expandable Cards

- Make the entire `ConfigCardRow` clickable via `onClick`
- Show chevron indicator (ChevronDown/ChevronUp) on the right
- Use `isActive={isExpanded()}` on `ConfigCard` for active state styling
- Expanded content goes in `ConfigCardExpandedContent`

#### Animated Actions

- Wrap action buttons in `<ConfigCardActions animated>`
- Actions slide in from the right on hover
- Use `alwaysVisible={isExpanded()}` to keep visible when expanded
- Always add `alwaysVisible` to `ConfigCardDeleteButton` inside animated actions

#### Icon Sizes

- Always use `size="sm"` on `ConfigCardIcon` (w-8 h-8)
- Icons inside: `w-4 h-4`

#### Status/Warning States

- Use `hasWarning` on `ConfigCard` for incomplete items (amber styling)
- Warning text uses `text-amber-600`
- Normal status text uses `text-muted-foreground`

#### Button Click Propagation

- Buttons inside clickable rows must call `e.stopPropagation()` to prevent row toggle

### Empty States

Use a centered layout with animated icon:

```tsx
<div class="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-lg">
    <div class="relative mb-4">
        <div class="absolute inset-0 bg-{color}-400/20 rounded-full blur-xl animate-pulse" />
        <div class="relative p-3 rounded-full bg-gradient-to-br from-{color}-100 to-{color}-50 border border-{color}-200/60">
            <Icon class="w-8 h-8 text-{color}-600" />
        </div>
    </div>
    <h3 class="text-lg font-medium text-foreground mb-1">No items yet</h3>
    <p class="text-sm text-muted-foreground text-center max-w-sm">Helpful description...</p>
</div>
```

### Skeletons

Match the card structure with `Skeleton` components:

```tsx
function CardSkeleton() {
    return (
        <div class="border border-border rounded-lg bg-muted/30 p-4">
            <div class="flex items-center gap-3">
                <Skeleton variant="circular" class="w-8 h-8" />
                <Skeleton variant="text" class="h-4 w-32" />
            </div>
        </div>
    )
}
```

---

## Emoji Replacement

Slack-style shortcodes (`:smile:`, `:fire:`) are replaced with actual emoji characters. The emoji data is loaded asynchronously from a CDN.

### useEmojis Hook

Use the `useEmojis` hook from `~/lib/emoji/emoji` to ensure emojis are loaded before rendering:

```tsx
import { replaceEmojis, useEmojis } from "~/lib/emoji/emoji";

function EmojiText(props: { text: string }) {
    const loaded = useEmojis();

    const html = createMemo(() => {
        loaded();
        return replaceEmojis(props.text);
    });

    return <span innerHTML={html()} />;
}
```

### Key Points

1. **Call `useEmojis()` in components that render emoji text** - returns a signal that triggers re-render when emojis load
2. **Access the signal in reactive contexts** - include `loaded()` in memos/effects to create dependency
3. **Custom Slack emojis** - use `setCustomEmojis()` to add workspace-specific emojis
