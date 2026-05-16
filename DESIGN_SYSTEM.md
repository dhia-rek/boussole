# Forsa Design System

An Apple-inspired design system focused on clarity, refinement, and exceptional user experience.

## Philosophy

Our design philosophy is rooted in Apple's principles:
- **Clarity**: Every element has a purpose
- **Refinement**: Generous whitespace, precise typography, subtle shadows
- **Simplicity**: Remove unnecessary complexity
- **Quality**: Attention to every detail
- **Human-centered**: Design for how people actually use the product

## Color Palette

### Primary Colors
The primary color is a modern, accessible blue inspired by Apple's interface:
```
--color-primary-500: #0071e3  (Primary Blue)
--color-primary-600: #0066cc  (Darker Blue)
--color-primary-700: #0052a3  (Deep Blue)
```

### Gray Scale
A refined neutral palette for backgrounds, text, and borders:
```
--color-gray-50:   #fafafa    (Lightest)
--color-gray-100:  #f5f5f7
--color-gray-900:  #2c2c2e    (Darkest)
```

### Semantic Colors
```
--color-success: #34c759  (Success/Positive)
--color-warning: #ff9500  (Warning)
--color-error:   #ff3b30  (Error/Destructive)
--color-info:    #0071e3  (Informational)
```

## Typography

### Font Stack
```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
```

### Type Scale
| Use Case | Size | Weight | Line Height |
|----------|------|--------|-------------|
| Display/H1 | 40px | 700 Bold | 48px |
| Heading/H2 | 32px | 700 Bold | 40px |
| Section/H3 | 28px | 700 Bold | 36px |
| Subhead/H4 | 24px | 600 SemiBold | 32px |
| Body | 16px | 400 Regular | 24px |
| Small | 13px | 400 Regular | 19px |
| Caption | 12px | 400 Regular | 16px |

**Letter Spacing**: -0.2px for headings (body text), -0.3px+ for larger text

## Spacing System

Consistent 4px baseline grid:
```
4px   (xs) - Tight spacing
8px   (sm) - Small spacing
12px  (md) - Medium spacing
16px  (lg) - Default spacing
24px  (xl) - Generous spacing
32px  (2xl) - Large spacing
```

## Shadows

Subtle, purposeful shadows that create depth:
```
--shadow-sm:   0 1px 2px 0 rgba(0, 0, 0, 0.05)
--shadow-md:   0 4px 12px 0 rgba(0, 0, 0, 0.08)
--shadow-lg:   0 12px 28px 0 rgba(0, 0, 0, 0.12)
--shadow-xl:   0 20px 40px 0 rgba(0, 0, 0, 0.15)
```

## Border Radius

Consistent, refined corner rounding:
```
4px   (xs)   - Small, subtle corners
6px   (sm)   - Slight rounding
8px   (md)   - Standard controls
12px  (lg)   - Cards and larger surfaces
16px  (xl)   - Major component containers
```

## Components

### Buttons

#### Primary Button
- Used for main call-to-action
- Background: Primary blue (#0071e3)
- Text: White
- Padding: 10px 24px (default), varies by size
- Border Radius: 8px
- Shadow: subtle

```jsx
<Button variant="default" size="default">
  Click me
</Button>
```

#### Outline Button
- Used for secondary actions
- Border: 2px gray
- Text: Gray
- Hover: Light gray background
- No shadow

```jsx
<Button variant="outline">
  Secondary action
</Button>
```

#### Ghost Button
- Used for tertiary or less prominent actions
- Background: Transparent
- Hover: Light gray background
- No border or shadow

```jsx
<Button variant="ghost">
  Tertiary action
</Button>
```

#### Link Button
- Used for navigation or inline actions
- No background or border
- Text: Primary blue, underlined on hover
- No padding

```jsx
<Button variant="link">
  Learn more
</Button>
```

### Cards

Cards are refined containers with subtle styling:
- Background: White (light mode), Gray-800 (dark mode)
- Border: 1px gray-200/gray-700
- Border Radius: 12px
- Shadow: subtle, increases on hover
- Padding: 24px

```jsx
<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Description</CardDescription>
  </CardHeader>
  <CardContent>
    {/* Content */}
  </CardContent>
  <CardFooter>
    {/* Actions */}
  </CardFooter>
</Card>
```

### Input Fields

Refined form inputs with clear focus states:
- Height: 40px
- Padding: 12px 16px
- Border: 2px gray-300/gray-600
- Border Radius: 8px
- Focus: Ring-2 primary-500, border transparent
- Transition: smooth 200ms

```jsx
<Input
  type="text"
  placeholder="Enter text..."
/>
```

## Interactions

### Transitions
- **Fast**: 150ms - Hover states, small interactions
- **Normal**: 200ms - Standard transitions
- **Smooth**: 300ms - Page transitions, staggered animations

### Timing Functions
```css
ease-out: cubic-bezier(0.33, 1, 0.68, 1)
ease-in-out: cubic-bezier(0.4, 0, 0.2, 1)
ease-smooth: cubic-bezier(0.34, 1.56, 0.64, 1)
```

### Animation Classes
```jsx
// Fade in
<div className="animate-fade-in">Content</div>

// Slide up with fade
<div className="animate-slide-up">Content</div>

// Slide down with fade
<div className="animate-slide-down">Content</div>
```

## Dark Mode

All components support automatic dark mode via CSS variables. Use Tailwind's `dark:` prefix:

```jsx
<div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
  Content adapts to light/dark mode
</div>
```

## Responsive Design

Mobile-first approach using Tailwind breakpoints:
- `sm`: 640px
- `md`: 768px
- `lg`: 1024px
- `xl`: 1280px

```jsx
<div className="text-base md:text-lg lg:text-xl">
  Scales with screen size
</div>
```

## Accessibility

### Color Contrast
- Minimum 4.5:1 ratio for text
- Use semantic HTML elements
- Always include focus states

### Focus States
```css
focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
```

### Labels
Always pair inputs with visible labels:
```jsx
<label htmlFor="username">Username</label>
<Input id="username" />
```

## Best Practices

### DO:
✅ Use semantic HTML  
✅ Include proper focus states  
✅ Test color contrast  
✅ Use intentional whitespace  
✅ Be consistent with typography  
✅ Animate purposefully  
✅ Support keyboard navigation  

### DON'T:
❌ Over-decorate with unnecessary elements  
❌ Use pure black/white (use grays)  
❌ Animate layout properties (use transform/opacity)  
❌ Make assumptions about color blindness  
❌ Ignore mobile experience  
❌ Use gradient text for readability  

## Examples

### Sign In Page
```jsx
<main className="min-h-screen flex items-center justify-center">
  <div className="w-full max-w-md">
    <h1 className="text-3xl font-bold tracking-tight mb-12">Sign in</h1>
    <form className="space-y-4">
      <Input type="email" placeholder="Email" />
      <Input type="password" placeholder="Password" />
      <Button className="w-full">Sign in</Button>
    </form>
  </div>
</main>
```

### Card-Based Layout
```jsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  <Card>
    <CardHeader>
      <CardTitle>Title</CardTitle>
    </CardHeader>
    <CardContent>
      Content goes here
    </CardContent>
  </Card>
</div>
```

## Resources

- **Tailwind CSS**: Configuration in `orchestrator/tailwind.config.ts`
- **Global Styles**: CSS variables and utilities in `orchestrator/src/index.css`
- **Components**: Reusable components in `orchestrator/src/components/ui/`

## Version History

- **v1.0** (May 2026): Initial Apple-inspired design system
  - Refined color palette
  - Improved typography scale
  - Smooth animations
  - Better component styling
  - Dark mode support
