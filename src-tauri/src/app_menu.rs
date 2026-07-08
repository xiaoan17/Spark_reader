//! Native macOS menu bar. Menu items don't act in Rust: every custom item
//! emits `app-menu://action` with its id and the frontend (ReaderShell) maps
//! ids to the same handlers the top bar uses, so menu and toolbar can never
//! drift apart. Non-macOS platforms keep the Tauri default (no custom menu).

#[cfg(target_os = "macos")]
pub fn install(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
    use tauri::Emitter;

    let settings = MenuItemBuilder::with_id("menu:settings", "设置…")
        .accelerator("Cmd+,")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "框选精读")
        .about(None)
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let import = MenuItemBuilder::with_id("menu:import", "导入 PDF…")
        .accelerator("Cmd+O")
        .build(app)?;
    let library = MenuItemBuilder::with_id("menu:library", "打开书架")
        .accelerator("Cmd+L")
        .build(app)?;
    let file_menu = SubmenuBuilder::new(app, "文件")
        .item(&import)
        .item(&library)
        .separator()
        .close_window()
        .build()?;

    // Without an Edit menu, Cmd+C/V/X stop working inside the webview on macOS.
    let edit_menu = SubmenuBuilder::new(app, "编辑")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let views: [(&str, &str, &str); 5] = [
        ("menu:view:text", "转换稿", "Cmd+1"),
        ("menu:view:tldr", "TLDR 摘要", "Cmd+2"),
        ("menu:view:translation", "对照翻译", "Cmd+3"),
        ("menu:view:knowledge", "知识体系", "Cmd+4"),
        ("menu:view:pdf", "原文 PDF", "Cmd+5"),
    ];
    let mut view_menu = SubmenuBuilder::new(app, "视图");
    for (id, label, accelerator) in views {
        let item = MenuItemBuilder::with_id(id, label)
            .accelerator(accelerator)
            .build(app)?;
        view_menu = view_menu.item(&item);
    }
    let sidebar = MenuItemBuilder::with_id("menu:sidebar", "收起/展开侧栏")
        .accelerator("Cmd+\\")
        .build(app)?;
    let appearance = MenuItemBuilder::with_id("menu:appearance", "阅读外观…").build(app)?;
    let view_menu = view_menu
        .separator()
        .item(&appearance)
        .item(&sidebar)
        .separator()
        .fullscreen()
        .build()?;

    let search = MenuItemBuilder::with_id("menu:search", "书内搜索")
        .accelerator("Cmd+F")
        .build(app)?;
    let obsidian = MenuItemBuilder::with_id("menu:obsidian", "Obsidian 导出设置…").build(app)?;
    let tools_menu = SubmenuBuilder::new(app, "工具")
        .item(&search)
        .separator()
        .item(&obsidian)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "窗口")
        .minimize()
        .maximize()
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &tools_menu,
            &window_menu,
        ])
        .build()?;
    app.set_menu(menu)?;

    app.on_menu_event(|app, event| {
        let id = event.id().0.as_str();
        if id.starts_with("menu:") {
            let _ = app.emit("app-menu://action", id);
        }
    });
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn install(_app: &tauri::AppHandle) -> tauri::Result<()> {
    Ok(())
}
