use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter, Manager};

use crate::{
    coordinates::COORDINATE_VERSION, embeddings, interpretation, llm, mineru, mineru_parser,
    product_self_check, storage, translation, zotero,
};

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    status: &'static str,
    coordinate_version: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BookAssetKind {
    Text,
    Markdown,
    OriginalPdf,
    AssetDirectory,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenBookAssetResponse {
    pub path: String,
}

#[command]
pub fn app_health() -> HealthResponse {
    HealthResponse {
        status: "ok",
        coordinate_version: COORDINATE_VERSION,
    }
}

#[command]
pub fn coordinate_version() -> u32 {
    COORDINATE_VERSION
}

#[command]
pub async fn test_llm_connection() -> Result<llm::ConnectionTestResponse, String> {
    llm::test_connection().await.map_err(|err| err.to_string())
}

#[command]
pub fn test_embedding_connection() -> Result<embeddings::EmbeddingConnectionTestResponse, String> {
    embeddings::test_connection().map_err(|err| err.to_string())
}

#[command]
pub fn get_llm_settings() -> Result<crate::config::LlmSettingsResponse, String> {
    crate::config::get_llm_settings().map_err(|err| err.to_string())
}

#[command]
pub fn get_embedding_settings() -> Result<crate::config::EmbeddingSettingsResponse, String> {
    crate::config::get_embedding_settings().map_err(|err| err.to_string())
}

#[command]
pub fn get_mineru_settings() -> Result<crate::config::MinerUSettingsResponse, String> {
    crate::config::get_mineru_settings().map_err(|err| err.to_string())
}

#[command]
pub fn save_llm_settings(
    request: crate::config::SaveLlmSettingsRequest,
) -> Result<crate::config::LlmSettingsResponse, String> {
    crate::config::save_llm_settings(request).map_err(|err| err.to_string())
}

#[command]
pub fn save_embedding_settings(
    request: crate::config::SaveEmbeddingSettingsRequest,
) -> Result<crate::config::EmbeddingSettingsResponse, String> {
    crate::config::save_embedding_settings(request).map_err(|err| err.to_string())
}

#[command]
pub fn save_mineru_settings(
    request: crate::config::SaveMinerUSettingsRequest,
) -> Result<crate::config::MinerUSettingsResponse, String> {
    crate::config::save_mineru_settings(request).map_err(|err| err.to_string())
}

#[command]
pub async fn product_self_check(
    app: AppHandle,
) -> Result<product_self_check::ProductSelfCheckResponse, String> {
    let base_dir = app
        .path()
        .app_cache_dir()
        .ok()
        .or_else(|| app.path().app_data_dir().ok());
    let resource_dir = app.path().resource_dir().ok();
    product_self_check::run_product_self_check_with_resource_dir(base_dir, resource_dir)
        .await
        .map_err(|err| err.to_string())
}

#[command]
pub fn search_zotero_items(
    query: String,
    limit: Option<u32>,
) -> Result<Vec<zotero::ZoteroSearchResult>, String> {
    zotero::search_items(&query, limit.unwrap_or(8)).map_err(|err| err.to_string())
}

#[command]
pub async fn import_zotero_item(
    app: AppHandle,
    item_key: String,
    page_count: Option<u32>,
) -> Result<storage::SaveBookResponse, String> {
    let resolved = zotero::resolve_item_pdf_path(&item_key).map_err(|err| err.to_string())?;
    import_pdf_with_mineru_title(
        app,
        resolved.pdf_path.to_string_lossy().to_string(),
        Some(resolved.title),
        None,
        page_count,
    )
    .await
}

async fn import_pdf_with_mineru_title(
    app: AppHandle,
    pdf_path: String,
    title: Option<String>,
    options: Option<mineru::MinerUParseOptions>,
    page_count: Option<u32>,
) -> Result<storage::SaveBookResponse, String> {
    let pdf_path_ref = std::path::Path::new(&pdf_path);
    let db_path = library_db_path(&app)?;
    if let Some(cached) =
        storage::find_book_by_source_pdf(&db_path, pdf_path_ref).map_err(|err| err.to_string())?
    {
        return Ok(storage::SaveBookResponse::from_cached_book(cached));
    }
    let resolved_title = title
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            pdf_path_ref
                .file_stem()
                .and_then(|stem| stem.to_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "converted-book".to_string());
    import_pdf_with_mineru_impl(app, pdf_path, resolved_title, options, page_count).await
}

#[command]
pub fn import_mineru_output(
    app: AppHandle,
    output_dir: String,
    title: Option<String>,
) -> Result<storage::SaveBookResponse, String> {
    let output_path = std::path::Path::new(&output_dir);
    let parsed =
        mineru_parser::parse_mineru_output_dir(output_path).map_err(|err| err.to_string())?;
    let title = title
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| mineru_parser::default_mineru_output_title(output_path));
    let source_pdf_path = mineru_parser::find_original_pdf(output_path)
        .map_err(|err| err.to_string())?
        .map(|path| path.to_string_lossy().to_string());
    let db_path = library_db_path(&app)?;
    storage::save_book_with_options(
        &db_path,
        storage::SaveBookRequest {
            title,
            total_pages: parsed.pages.len() as u32,
            parser_engine: parsed.engine,
            coordinate_mode: parsed.coordinate_mode,
            quality: Some(parsed.quality),
            source_pdf_path,
            source_asset_dir: Some(output_path.to_string_lossy().to_string()),
            source_asset_dirs: Vec::new(),
            pages: parsed.pages,
            chunks: parsed.chunks,
        },
        storage::SaveBookOptions {
            skip_embedding_rebuild: true,
        },
    )
    .map_err(|err| err.to_string())
}

#[command]
pub async fn import_pdf_with_mineru(
    app: AppHandle,
    pdf_path: String,
    options: Option<mineru::MinerUParseOptions>,
    page_count: Option<u32>,
) -> Result<storage::SaveBookResponse, String> {
    let title = std::path::Path::new(&pdf_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("mineru-book")
        .to_string();
    import_pdf_with_mineru_impl(
        app,
        pdf_path,
        format!("{title} · MinerU"),
        options,
        page_count,
    )
    .await
}

async fn import_pdf_with_mineru_impl(
    app: AppHandle,
    pdf_path: String,
    title: String,
    options: Option<mineru::MinerUParseOptions>,
    page_count: Option<u32>,
) -> Result<storage::SaveBookResponse, String> {
    let pdf_path_ref = std::path::Path::new(&pdf_path);
    let db_path = library_db_path(&app)?;
    if let Some(cached) =
        storage::find_book_by_source_pdf(&db_path, pdf_path_ref).map_err(|err| err.to_string())?
    {
        let _ = app.emit(
            mineru::MINERU_PROGRESS_EVENT,
            mineru::MinerUProgressEvent {
                stage: mineru::MinerUProgressStage::Indexed,
                message: "已在本地书库找到同源转换稿，跳过 MinerU 上传".to_string(),
                batch_id: None,
                poll_count: 0,
                state: Some("cached".to_string()),
                batch_index: None,
                batch_total: None,
                page_range: None,
            },
        );
        return Ok(storage::SaveBookResponse::from_cached_book(cached));
    }
    let app_data_dir = app
        .path()
        .app_data_dir()
        .ok()
        .or_else(|| db_path.parent().map(|parent| parent.to_path_buf()))
        .ok_or_else(|| "failed to resolve app data directory".to_string())?;
    let output_base_dir = app_data_dir.join("mineru-results");
    let progress_app = app.clone();
    let progress = move |event: mineru::MinerUProgressEvent| {
        let _ = progress_app.emit(mineru::MINERU_PROGRESS_EVENT, event);
    };
    let detected_page_count = page_count
        .map(|value| value as usize)
        .or_else(|| pdf_page_count_hint(pdf_path_ref));
    let jobs = mineru::parse_pdf_to_output_dirs_with_progress(
        pdf_path_ref,
        &output_base_dir,
        options.unwrap_or_default(),
        detected_page_count,
        Some(&progress),
    )
    .await
    .map_err(|err| {
        let _ = app.emit(
            mineru::MINERU_PROGRESS_EVENT,
            mineru::MinerUProgressEvent {
                stage: mineru::MinerUProgressStage::Failed,
                message: err.to_string(),
                batch_id: None,
                poll_count: 0,
                state: Some("failed".to_string()),
                batch_index: None,
                batch_total: None,
                page_range: None,
            },
        );
        err.to_string()
    })?;
    let _ = app.emit(
        mineru::MINERU_PROGRESS_EVENT,
        mineru::MinerUProgressEvent {
            stage: mineru::MinerUProgressStage::Parsing,
            message: "正在读取 MinerU layout.json/full.md 并生成 chunk".to_string(),
            batch_id: jobs.last().map(|job| job.batch_id.clone()),
            poll_count: jobs.iter().map(|job| job.poll_count).sum(),
            state: jobs.last().map(|job| job.state.clone()),
            batch_index: None,
            batch_total: None,
            page_range: None,
        },
    );
    let mut parsed_documents = Vec::with_capacity(jobs.len());
    for job in &jobs {
        let output_path = std::path::Path::new(&job.output_dir);
        let parsed =
            mineru_parser::parse_mineru_output_dir(output_path).map_err(|err| err.to_string())?;
        let parsed = mineru_parser::remap_relative_batch_pages(parsed, job.page_range.as_deref());
        let parsed = if let Some(prefix) = output_path.file_name().and_then(|name| name.to_str()) {
            mineru_parser::prefix_relative_markdown_asset_paths(parsed, prefix)
        } else {
            parsed
        };
        parsed_documents.push(parsed);
    }
    let parsed =
        mineru_parser::merge_mineru_documents(parsed_documents).map_err(|err| err.to_string())?;

    let saved = storage::save_book_with_options(
        &db_path,
        storage::SaveBookRequest {
            title,
            total_pages: parsed.pages.len() as u32,
            parser_engine: parsed.engine,
            coordinate_mode: parsed.coordinate_mode,
            quality: Some(parsed.quality),
            source_pdf_path: Some(pdf_path),
            source_asset_dir: None,
            source_asset_dirs: jobs.iter().map(|job| job.output_dir.clone()).collect(),
            pages: parsed.pages,
            chunks: parsed.chunks,
        },
        storage::SaveBookOptions {
            skip_embedding_rebuild: true,
        },
    )
    .map_err(|err| err.to_string())?;
    let _ = app.emit(
        mineru::MINERU_PROGRESS_EVENT,
        mineru::MinerUProgressEvent {
            stage: mineru::MinerUProgressStage::Indexed,
            message: format!(
                "已写入本地文本索引：{} 字、{} 个 chunk",
                saved.text_char_count, saved.chunk_count
            ),
            batch_id: jobs.last().map(|job| job.batch_id.clone()),
            poll_count: jobs.iter().map(|job| job.poll_count).sum(),
            state: Some("indexed".to_string()),
            batch_index: None,
            batch_total: None,
            page_range: None,
        },
    );
    Ok(saved)
}

#[command]
pub fn read_pdf_file(pdf_path: String) -> Result<Vec<u8>, String> {
    let path = std::path::Path::new(&pdf_path);
    let is_pdf = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);
    if !is_pdf {
        return Err("only PDF files can be read".to_string());
    }
    std::fs::read(path).map_err(|err| err.to_string())
}

#[command]
pub fn open_book_asset(
    app: AppHandle,
    book_id: String,
    kind: BookAssetKind,
) -> Result<OpenBookAssetResponse, String> {
    let db_path = library_db_path(&app)?;
    let path = resolve_book_asset_path(&db_path, &book_id, kind)?;
    launch_open_path(&path)?;
    Ok(OpenBookAssetResponse {
        path: path.to_string_lossy().to_string(),
    })
}

#[command]
pub fn reveal_book_asset(
    app: AppHandle,
    book_id: String,
    kind: BookAssetKind,
) -> Result<OpenBookAssetResponse, String> {
    let db_path = library_db_path(&app)?;
    let path = resolve_book_asset_path(&db_path, &book_id, kind)?;
    launch_reveal_path(&path)?;
    Ok(OpenBookAssetResponse {
        path: path.to_string_lossy().to_string(),
    })
}

#[command]
pub fn search_book(
    app: AppHandle,
    book_id: String,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<storage::SearchHit>, String> {
    let db_path = library_db_path(&app)?;
    storage::hybrid_search_book(&db_path, &book_id, &query, limit.unwrap_or(12))
        .map_err(|err| err.to_string())
}

#[command]
pub fn rebuild_search_index(
    app: AppHandle,
    book_id: String,
) -> Result<storage::SearchIndexSummary, String> {
    let db_path = library_db_path(&app)?;
    storage::rebuild_search_index(&db_path, &book_id).map_err(|err| err.to_string())
}

#[command]
pub fn search_index_summary(
    app: AppHandle,
    book_id: String,
) -> Result<storage::SearchIndexSummary, String> {
    let db_path = library_db_path(&app)?;
    storage::search_index_summary(&db_path, &book_id).map_err(|err| err.to_string())
}

#[command]
pub fn get_chunk(
    app: AppHandle,
    book_id: String,
    chunk_id: String,
) -> Result<Option<storage::SearchHit>, String> {
    let db_path = library_db_path(&app)?;
    storage::get_chunk(&db_path, &book_id, &chunk_id).map_err(|err| err.to_string())
}

#[command]
pub fn get_neighbors(
    app: AppHandle,
    book_id: String,
    chunk_id: String,
    radius: Option<u32>,
) -> Result<Vec<storage::SearchHit>, String> {
    let db_path = library_db_path(&app)?;
    storage::get_neighbors(&db_path, &book_id, &chunk_id, radius.unwrap_or(1))
        .map_err(|err| err.to_string())
}

#[command]
pub fn list_structure(app: AppHandle, book_id: String) -> Result<Vec<storage::SearchHit>, String> {
    let db_path = library_db_path(&app)?;
    storage::list_structure(&db_path, &book_id).map_err(|err| err.to_string())
}

#[command]
pub fn list_books(app: AppHandle) -> Result<Vec<storage::StoredBookSummary>, String> {
    let db_path = library_db_path(&app)?;
    storage::list_books(&db_path).map_err(|err| err.to_string())
}

#[command]
pub fn get_converted_book(
    app: AppHandle,
    book_id: String,
) -> Result<storage::StoredBookAsset, String> {
    let db_path = library_db_path(&app)?;
    storage::get_converted_book(&db_path, &book_id).map_err(|err| err.to_string())
}

#[command]
pub fn find_book_by_source_pdf(
    app: AppHandle,
    pdf_path: String,
) -> Result<Option<storage::StoredBookSummary>, String> {
    let db_path = library_db_path(&app)?;
    storage::find_book_by_source_pdf(&db_path, std::path::Path::new(&pdf_path))
        .map_err(|err| err.to_string())
}

#[command]
pub fn save_highlight(
    app: AppHandle,
    request: storage::SaveHighlightRequest,
) -> Result<storage::SavedHighlight, String> {
    let db_path = library_db_path(&app)?;
    storage::save_highlight(&db_path, request).map_err(|err| err.to_string())
}

#[command]
pub fn list_highlights(
    app: AppHandle,
    book_id: String,
) -> Result<Vec<storage::SavedHighlight>, String> {
    let db_path = library_db_path(&app)?;
    storage::list_highlights(&db_path, &book_id).map_err(|err| err.to_string())
}

#[command]
pub fn delete_highlight(app: AppHandle, highlight_id: String) -> Result<(), String> {
    let db_path = library_db_path(&app)?;
    storage::delete_highlight(&db_path, &highlight_id).map_err(|err| err.to_string())
}

#[command]
pub fn delete_book(app: AppHandle, book_id: String) -> Result<storage::DeleteBookResponse, String> {
    let db_path = library_db_path(&app)?;
    storage::delete_book(&db_path, &book_id).map_err(|err| err.to_string())
}

#[command]
pub fn save_interpretation(
    app: AppHandle,
    request: storage::SaveInterpretationRequest,
) -> Result<storage::SavedInterpretation, String> {
    let db_path = library_db_path(&app)?;
    storage::save_interpretation(&db_path, request).map_err(|err| err.to_string())
}

#[command]
pub fn list_interpretations(
    app: AppHandle,
    book_id: String,
) -> Result<Vec<storage::SavedInterpretation>, String> {
    let db_path = library_db_path(&app)?;
    storage::list_interpretations(&db_path, &book_id).map_err(|err| err.to_string())
}

#[command]
pub fn delete_interpretation(app: AppHandle, interpretation_id: String) -> Result<(), String> {
    let db_path = library_db_path(&app)?;
    storage::delete_interpretation(&db_path, &interpretation_id).map_err(|err| err.to_string())
}

#[command]
pub async fn interpret_selection(
    app: AppHandle,
    request: interpretation::InterpretRequest,
    request_id: Option<String>,
) -> Result<interpretation::InterpretResponse, String> {
    let db_path = library_db_path(&app)?;
    if let Some(request_id) = request_id.filter(|value| !value.trim().is_empty()) {
        interpretation::interpret_with_progress(app, request_id, &db_path, request)
            .await
            .map_err(|err| err.to_string())
    } else {
        interpretation::interpret(&db_path, request)
            .await
            .map_err(|err| err.to_string())
    }
}

#[command]
pub fn cancel_interpretation(request_id: String) -> bool {
    interpretation::cancel_interpretation(&request_id)
}

#[command]
pub async fn start_translation(
    app: AppHandle,
    request: translation::StartTranslationRequest,
) -> Result<translation::TranslationStatus, String> {
    let db_path = library_db_path(&app)?;
    if translation::is_translation_running(&request.book_id) {
        return translation::translation_status(&db_path, &request.book_id)
            .map_err(|err| err.to_string());
    }
    let book_id = request.book_id.clone();
    storage::get_converted_book(&db_path, &book_id).map_err(|err| err.to_string())?;
    translation::translation_status(&db_path, &book_id).map_err(|err| err.to_string())?;
    tauri::async_runtime::spawn(async move {
        if let Err(error) = translation::start_translation(&db_path, request).await {
            eprintln!("translation job failed: {error:#}");
        }
    });
    translation::translation_status(&library_db_path(&app)?, &book_id)
        .map_err(|err| err.to_string())
}

#[command]
pub fn translation_status(
    app: AppHandle,
    book_id: String,
) -> Result<translation::TranslationStatus, String> {
    let db_path = library_db_path(&app)?;
    translation::translation_status(&db_path, &book_id).map_err(|err| err.to_string())
}

#[command]
pub fn cancel_translation(book_id: String) -> bool {
    translation::cancel_translation(&book_id)
}

fn library_db_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().ok();
    storage::default_db_path(app_data_dir).map_err(|err| err.to_string())
}

fn resolve_book_asset_path(
    db_path: &std::path::Path,
    book_id: &str,
    kind: BookAssetKind,
) -> Result<std::path::PathBuf, String> {
    let asset = storage::get_converted_book(db_path, book_id).map_err(|err| err.to_string())?;
    let path = match kind {
        BookAssetKind::Text => std::path::PathBuf::from(asset.text_path),
        BookAssetKind::Markdown => std::path::PathBuf::from(asset.markdown_path),
        BookAssetKind::OriginalPdf => std::path::PathBuf::from(asset.original_pdf_path),
        BookAssetKind::AssetDirectory => {
            let candidate = first_non_empty_path(&[
                asset.text_path,
                asset.markdown_path,
                asset.original_pdf_path,
            ])?;
            candidate
                .parent()
                .map(std::path::Path::to_path_buf)
                .ok_or_else(|| "converted asset has no parent directory".to_string())?
        }
    };
    if path.as_os_str().is_empty() {
        return Err("requested book asset is not available".to_string());
    }
    if !path.exists() {
        return Err(format!("book asset does not exist: {}", path.display()));
    }
    Ok(path)
}

fn first_non_empty_path(paths: &[String]) -> Result<std::path::PathBuf, String> {
    paths
        .iter()
        .find(|path| !path.trim().is_empty())
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "converted book has no local asset path".to_string())
}

fn pdf_page_count_hint(path: &std::path::Path) -> Option<usize> {
    let bytes = std::fs::read(path).ok()?;
    let mut count = 0_usize;
    let mut cursor = 0_usize;
    while let Some(relative_pos) = find_bytes(&bytes[cursor..], b"/Type") {
        let mut index = cursor + relative_pos + b"/Type".len();
        while matches!(
            bytes.get(index),
            Some(b' ' | b'\t' | b'\r' | b'\n' | 0x0c | 0x00)
        ) {
            index += 1;
        }
        if bytes
            .get(index..index + b"/Page".len())
            .is_some_and(|candidate| candidate == b"/Page")
            && !bytes
                .get(index + b"/Page".len())
                .copied()
                .is_some_and(is_pdf_name_char)
        {
            count += 1;
        }
        cursor = index.saturating_add(b"/Page".len()).min(bytes.len());
    }
    (count > 0).then_some(count)
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn is_pdf_name_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b'+')
}

fn launch_open_path(path: &std::path::Path) -> Result<(), String> {
    launch_path(path, false)
}

fn launch_reveal_path(path: &std::path::Path) -> Result<(), String> {
    launch_path(path, true)
}

#[cfg(target_os = "macos")]
fn launch_path(path: &std::path::Path, reveal: bool) -> Result<(), String> {
    let mut command = std::process::Command::new("open");
    if reveal && path.is_file() {
        command.arg("-R");
    }
    command.arg(path);
    spawn_launch_command(command)
}

#[cfg(target_os = "windows")]
fn launch_path(path: &std::path::Path, reveal: bool) -> Result<(), String> {
    if reveal {
        let mut command = std::process::Command::new("explorer");
        if path.is_file() {
            command.arg(format!("/select,{}", path.display()));
        } else {
            command.arg(path);
        }
        return spawn_launch_command(command);
    }

    let mut command = std::process::Command::new("cmd");
    command.arg("/C").arg("start").arg("").arg(path);
    spawn_launch_command(command)
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn launch_path(path: &std::path::Path, reveal: bool) -> Result<(), String> {
    let target = if reveal && path.is_file() {
        path.parent().unwrap_or(path)
    } else {
        path
    };
    let mut command = std::process::Command::new("xdg-open");
    command.arg(target);
    spawn_launch_command(command)
}

fn spawn_launch_command(mut command: std::process::Command) -> Result<(), String> {
    command
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("failed to open local asset: {err}"))
}
