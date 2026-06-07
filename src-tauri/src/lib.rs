mod chunk_id;
mod commands;
mod config;
mod embeddings;
mod interpretation;
mod knowledge;
mod llm;
mod mineru;
mod mineru_parser;
mod plain_book_parser;
mod product_self_check;
mod storage;
mod translation;
mod zotero;

pub mod coordinates;

#[cfg(test)]
pub(crate) static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::app_health,
            commands::build_knowledge_graph,
            commands::cancel_interpretation,
            commands::cancel_translation,
            commands::confirm_knowledge_card,
            commands::coordinate_version,
            commands::delete_book,
            commands::delete_highlight,
            commands::delete_interpretation,
            commands::delete_knowledge_card,
            commands::export_book_knowledge_json,
            commands::export_book_knowledge_markdown,
            commands::find_book_by_source_pdf,
            commands::get_book_knowledge_map,
            commands::get_converted_book,
            commands::get_converted_book_manifest,
            commands::get_converted_book_pages,
            commands::get_chunk,
            commands::get_embedding_settings,
            commands::get_knowledge_card,
            commands::get_knowledge_graph,
            commands::get_mineru_settings,
            commands::get_or_generate_card_summary,
            commands::get_or_generate_document_tldr,
            commands::get_or_generate_highlight_note,
            commands::get_neighbors,
            commands::get_llm_settings,
            commands::import_mineru_output,
            commands::import_plain_book,
            commands::import_pdf_with_mineru,
            commands::import_zotero_item,
            commands::interpret_selection,
            commands::list_highlights,
            commands::list_interpretations,
            commands::list_knowledge_cards,
            commands::list_knowledge_cards_by_chunk,
            commands::list_knowledge_drift,
            commands::list_books,
            commands::list_structure,
            commands::knowledge_health,
            commands::open_book_asset,
            commands::product_self_check,
            commands::read_pdf_file,
            commands::rebuild_search_index,
            commands::rebuild_search_index_async,
            commands::reject_knowledge_card,
            commands::reveal_book_asset,
            commands::save_highlight,
            commands::save_embedding_settings,
            commands::save_interpretation,
            commands::save_llm_settings,
            commands::save_mineru_settings,
            commands::search_book,
            commands::search_index_summary,
            commands::search_knowledge,
            commands::search_zotero_items,
            commands::start_translation,
            commands::test_embedding_connection,
            commands::test_llm_connection,
            commands::test_llm_connection_with_settings,
            commands::translation_status,
            commands::upsert_knowledge_card,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri app");
}

pub fn run_cli_if_requested() -> Option<i32> {
    let mut args = std::env::args().skip(1);
    let command = args.next()?;
    match command.as_str() {
        "--product-self-check" => Some(run_product_self_check_cli(args.next())),
        "--help" | "-h" => {
            print_cli_help();
            Some(0)
        }
        _ => None,
    }
}

fn run_product_self_check_cli(base_dir_arg: Option<String>) -> i32 {
    let base_dir = base_dir_arg
        .filter(|value| !value.trim().is_empty())
        .map(std::path::PathBuf::from);
    let resource_dir = bundled_resource_dir_for_cli();
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(err) => {
            eprintln!("failed to start self-check runtime: {err}");
            return 1;
        }
    };
    match runtime.block_on(
        product_self_check::run_product_self_check_with_resource_dir(base_dir, resource_dir),
    ) {
        Ok(result) => match serde_json::to_string_pretty(&result) {
            Ok(json) => {
                println!("{json}");
                if result.ok {
                    0
                } else {
                    1
                }
            }
            Err(err) => {
                eprintln!("failed to serialize self-check result: {err}");
                1
            }
        },
        Err(err) => {
            eprintln!("{err:#}");
            1
        }
    }
}

fn bundled_resource_dir_for_cli() -> Option<std::path::PathBuf> {
    let executable = std::env::current_exe().ok()?;
    let macos_dir = executable.parent()?;
    let contents_dir = macos_dir.parent()?;
    let resources_dir = contents_dir.join("Resources");
    resources_dir.exists().then_some(resources_dir)
}

fn print_cli_help() {
    println!(
        "Spark\n\nUsage:\n  focused-reading                  Launch desktop app\n  focused-reading --product-self-check [base_dir]\n      Run the offline product self-check and print JSON.\n"
    );
}
