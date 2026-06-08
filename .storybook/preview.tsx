import { useEffect } from "react"
import type { Decorator, Preview } from "@storybook/react"
import "../src/styles.css"

/**
 * Sync the `theme` toolbar global to the `.dark` class on <html>, so every story
 * can be reviewed in both light and dark themes (the app's dark tokens live in
 * styles.css under `.dark`). Without this, dark-mode regressions ship blind.
 */
const withTheme: Decorator = (Story, context) => {
  const theme = (context.globals.theme as "light" | "dark") ?? "light"
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle("dark", theme === "dark")
    return () => {
      root.classList.remove("dark")
    }
  }, [theme])
  return (
    <div className="bg-background text-foreground" style={{ minHeight: "100vh", padding: "1rem" }}>
      <Story />
    </div>
  )
}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  globalTypes: {
    theme: {
      description: "全局主题（light / dark）",
      defaultValue: "light",
      toolbar: {
        title: "主题",
        icon: "circlehollow",
        items: [
          { value: "light", title: "浅色", icon: "sun" },
          { value: "dark", title: "暗色", icon: "moon" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [withTheme],
}

export default preview
