use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter, Manager};

use crate::{
    coordinates::COORDINATE_VERSION, embeddings, interpretation, knowledge, llm, mineru,
    mineru_parser, obsidian, plain_book_parser, product_self_check, storage, translation, zotero,
};

pub const SEARCH_INDEX_PROGRESS_EVENT: &str = "search-index://progress";

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexTaskResponse {
    pub task_id: String,
    pub book_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexProgressEvent {
    pub task_id: String,
    pub book_id: String,
    pub stage: SearchIndexProgressStage,
    pub message: String,
    pub summary: Option<storage::SearchIndexSummary>,
    pub error: Option<CommandError>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SearchIndexProgressStage {
    Started,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
    pub suggestion: Option<&'static str>,
}

pub type CommandResult<T> = Result<T, CommandError>;

impl CommandError {
    fn new(
        code: &'static str,
        message: impl Into<String>,
        suggestion: Option<&'static str>,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            suggestion,
        }
    }

    fn from_message(message: impl Into<String>) -> Self {
        let message = message.into();
        let (code, suggestion) = classify_command_error(&message);
        Self::new(code, message, suggestion)
    }

    fn validation(message: impl Into<String>) -> Self {
        Self::new(
            "validation",
            message,
            Some("请检查输入内容后重试；如果问题持续，请保留当前书籍并重新导入。"),
        )
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self::new(
            "not_found",
            message,
            Some("请确认书籍或本地文件仍存在；必要时从书架重新打开或重新导入。"),
        )
    }
}

impl From<String> for CommandError {
    fn from(value: String) -> Self {
        Self::from_message(value)
    }
}

impl From<&str> for CommandError {
    fn from(value: &str) -> Self {
        Self::from_message(value)
    }
}

fn command_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::from_message(error.to_string())
}

fn generate_task_id(prefix: &str) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{prefix}-{now}")
}

fn classify_command_error(message: &str) -> (&'static str, Option<&'static str>) {
    let lower = message.to_lowercase();
    if lower.contains("mineru") && (lower.contains("token") || lower.contains("api key")) {
        return (
            "mineru_token",
            Some("请在设置里填入有效的 MinerU API Token 后重试。"),
        );
    }
    if lower.contains("a0202") || lower.contains("a0211") {
        return (
            "mineru_token",
            Some("请在设置里填入有效的 MinerU API Token 后重试。"),
        );
    }
    if lower.contains("401") || lower.contains("403") || lower.contains("unauthorized") {
        return (
            "authentication",
            Some("请检查当前服务的 API Key 或 Token 是否正确、是否仍有效。"),
        );
    }
    if lower.contains("timeout") || lower.contains("timed out") {
        return (
            "timeout",
            Some("请稍后重试；长 PDF 可先确认页数，必要时分批解析。"),
        );
    }
    if lower.contains("network")
        || lower.contains("connection")
        || lower.contains("dns")
        || lower.contains("econn")
    {
        return ("network", Some("请检查网络、代理或云端服务状态后重试。"));
    }
    if lower.contains("200mb")
        || lower.contains("200 mb")
        || lower.contains("200 pages")
        || lower.contains("page limit")
    {
        return (
            "mineru_limit",
            Some("PDF 超出单批解析限制，请换用较小文件或按页码范围分批解析。"),
        );
    }
    if lower.contains("only pdf") || lower.contains("invalid") || lower.contains("unsupported") {
        return (
            "validation",
            Some("请检查文件类型、页码范围或配置项后重试。"),
        );
    }
    if lower.contains("not found")
        || lower.contains("no such file")
        || lower.contains("does not exist")
        || lower.contains("not available")
    {
        return (
            "not_found",
            Some("请确认书籍或本地文件仍存在；必要时从书架重新打开或重新导入。"),
        );
    }
    if lower.contains("sqlite") || lower.contains("database") {
        return (
            "storage",
            Some("本地书库读写失败，请确认应用数据目录可访问后重试。"),
        );
    }
    (
        "unknown",
        Some("请保留当前阅读内容后重试；如果问题持续，可打开开发诊断查看详情。"),
    )
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
pub fn open_external_url(url: String) -> CommandResult<()> {
    let url = validate_external_https_url(&url)?;
    launch_external_url(&url)
}

#[command]
pub async fn test_llm_connection() -> CommandResult<llm::ConnectionTestResponse> {
    llm::test_connection().await.map_err(command_error)
}

#[command]
pub async fn test_llm_connection_with_settings(
    request: crate::config::SaveLlmSettingsRequest,
) -> CommandResult<llm::ConnectionTestResponse> {
    llm::test_connection_with_settings(request)
        .await
        .map_err(command_error)
}

#[command]
pub fn test_embedding_connection() -> CommandResult<embeddings::EmbeddingConnectionTestResponse> {
    embeddings::test_connection().map_err(command_error)
}

#[command]
pub async fn test_mineru_connection_with_settings(
    request: crate::config::SaveMinerUSettingsRequest,
) -> CommandResult<mineru::MinerUConnectionTestResponse> {
    mineru::test_connection_with_settings(request)
        .await
        .map_err(command_error)
}

#[command]
pub fn get_llm_settings() -> CommandResult<crate::config::LlmSettingsResponse> {
    crate::config::get_llm_settings().map_err(command_error)
}

#[command]
pub fn get_embedding_settings() -> CommandResult<crate::config::EmbeddingSettingsResponse> {
    crate::config::get_embedding_settings().map_err(command_error)
}

#[command]
pub fn get_mineru_settings() -> CommandResult<crate::config::MinerUSettingsResponse> {
    crate::config::get_mineru_settings().map_err(command_error)
}

#[command]
pub fn save_llm_settings(
    request: crate::config::SaveLlmSettingsRequest,
) -> CommandResult<crate::config::LlmSettingsResponse> {
    crate::config::save_llm_settings(request).map_err(command_error)
}

#[command]
pub fn save_embedding_settings(
    request: crate::config::SaveEmbeddingSettingsRequest,
) -> CommandResult<crate::config::EmbeddingSettingsResponse> {
    crate::config::save_embedding_settings(request).map_err(command_error)
}

#[command]
pub fn save_mineru_settings(
    request: crate::config::SaveMinerUSettingsRequest,
) -> CommandResult<crate::config::MinerUSettingsResponse> {
    crate::config::save_mineru_settings(request).map_err(command_error)
}

#[command]
pub async fn product_self_check(
    app: AppHandle,
) -> CommandResult<product_self_check::ProductSelfCheckResponse> {
    let base_dir = app
        .path()
        .app_cache_dir()
        .ok()
        .or_else(|| app.path().app_data_dir().ok());
    let resource_dir = app.path().resource_dir().ok();
    product_self_check::run_product_self_check_with_resource_dir(base_dir, resource_dir)
        .await
        .map_err(command_error)
}

#[command]
pub fn search_zotero_items(
    query: String,
    limit: Option<u32>,
) -> CommandResult<Vec<zotero::ZoteroSearchResult>> {
    zotero::search_items(&query, limit.unwrap_or(8)).map_err(command_error)
}

#[command]
pub async fn import_zotero_item(
    app: AppHandle,
    item_key: String,
    page_count: Option<u32>,
) -> CommandResult<storage::SaveBookResponse> {
    let resolved = zotero::resolve_item_pdf_path(&item_key).map_err(command_error)?;
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
) -> CommandResult<storage::SaveBookResponse> {
    let pdf_path_ref = std::path::Path::new(&pdf_path);
    let db_path = library_db_path(&app)?;
    if let Some(cached) = storage::find_book_by_source_pdf_with_engine(
        &db_path,
        pdf_path_ref,
        parser_engine_is_current_mineru,
    )
    .map_err(command_error)?
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
) -> CommandResult<storage::SaveBookResponse> {
    let output_path = std::path::Path::new(&output_dir);
    let parsed = mineru_parser::parse_mineru_output_dir(output_path).map_err(command_error)?;
    let title = title
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| mineru_parser::default_mineru_output_title(output_path));
    let source_pdf_path = mineru_parser::find_original_pdf(output_path)
        .map_err(command_error)?
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
    .map_err(command_error)
}

#[command]
pub async fn import_pdf_with_mineru(
    app: AppHandle,
    pdf_path: String,
    options: Option<mineru::MinerUParseOptions>,
    page_count: Option<u32>,
) -> CommandResult<storage::SaveBookResponse> {
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

#[command]
pub fn import_plain_book(
    app: AppHandle,
    file_path: String,
    title: Option<String>,
) -> CommandResult<storage::SaveBookResponse> {
    let path = std::path::Path::new(&file_path);
    if !plain_book_parser::supported_plain_book_extension(path) {
        return Err(CommandError::validation(
            "只支持导入 TXT 文本和 EPUB 电子书",
        ));
    }
    let db_path = library_db_path(&app)?;
    if let Some(cached) =
        storage::find_book_by_source_pdf_with_engine(&db_path, path, |parser_engine| {
            parser_engine == "text-import-txt" || parser_engine == "text-import-epub"
        })
        .map_err(command_error)?
    {
        return Ok(storage::SaveBookResponse::from_cached_book(cached));
    }
    let parsed = plain_book_parser::parse_plain_book(path, title).map_err(command_error)?;
    storage::save_book_with_options(
        &db_path,
        storage::SaveBookRequest {
            title: parsed.title,
            total_pages: parsed.pages.len() as u32,
            parser_engine: parsed.engine,
            coordinate_mode: parsed.coordinate_mode,
            quality: Some(parsed.quality),
            source_pdf_path: Some(file_path),
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: parsed.pages,
            chunks: parsed.chunks,
        },
        storage::SaveBookOptions {
            skip_embedding_rebuild: true,
        },
    )
    .map_err(command_error)
}

async fn import_pdf_with_mineru_impl(
    app: AppHandle,
    pdf_path: String,
    title: String,
    options: Option<mineru::MinerUParseOptions>,
    page_count: Option<u32>,
) -> CommandResult<storage::SaveBookResponse> {
    let pdf_path_ref = std::path::Path::new(&pdf_path);
    let db_path = library_db_path(&app)?;
    if let Some(cached) = storage::find_book_by_source_pdf_with_engine(
        &db_path,
        pdf_path_ref,
        parser_engine_is_current_mineru,
    )
    .map_err(command_error)?
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
        .ok_or_else(|| CommandError::from("failed to resolve app data directory"))?;
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
    let should_prefix_asset_paths = jobs.len() > 1;
    let mut parsed_documents = Vec::with_capacity(jobs.len());
    for job in &jobs {
        let output_path = std::path::Path::new(&job.output_dir);
        let parsed = mineru_parser::parse_mineru_output_dir(output_path).map_err(command_error)?;
        let parsed = mineru_parser::remap_relative_batch_pages(parsed, job.page_range.as_deref());
        let parsed = if should_prefix_asset_paths {
            if let Some(prefix) = output_path.file_name().and_then(|name| name.to_str()) {
                mineru_parser::prefix_relative_markdown_asset_paths(parsed, prefix)
            } else {
                parsed
            }
        } else {
            parsed
        };
        parsed_documents.push(parsed);
    }
    let parsed = mineru_parser::merge_mineru_documents(parsed_documents).map_err(command_error)?;

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
    .map_err(command_error)?;
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

fn parser_engine_is_current_mineru(parser_engine: &str) -> bool {
    parser_engine == "mineru-content-list" || parser_engine == "mineru-content-list-batched"
}

#[command]
pub fn read_pdf_file(pdf_path: String) -> CommandResult<Vec<u8>> {
    let path = std::path::Path::new(&pdf_path);
    let is_pdf = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);
    if !is_pdf {
        return Err(CommandError::validation("only PDF files can be read"));
    }
    std::fs::read(path).map_err(command_error)
}

#[command]
pub fn open_book_asset(
    app: AppHandle,
    book_id: String,
    kind: BookAssetKind,
) -> CommandResult<OpenBookAssetResponse> {
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
) -> CommandResult<OpenBookAssetResponse> {
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
) -> CommandResult<Vec<storage::SearchHit>> {
    let db_path = library_db_path(&app)?;
    storage::hybrid_search_book(&db_path, &book_id, &query, limit.unwrap_or(12))
        .map_err(command_error)
}

#[command]
pub fn rebuild_search_index(
    app: AppHandle,
    book_id: String,
) -> CommandResult<storage::SearchIndexSummary> {
    let db_path = library_db_path(&app)?;
    storage::rebuild_search_index(&db_path, &book_id).map_err(command_error)
}

#[command]
pub fn rebuild_search_index_async(
    app: AppHandle,
    book_id: String,
    task_id: Option<String>,
) -> CommandResult<SearchIndexTaskResponse> {
    let db_path = library_db_path(&app)?;
    let task_id = task_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| generate_task_id("search-index"));
    let task_book_id = book_id.clone();
    let task_id_for_thread = task_id.clone();
    std::thread::spawn(move || {
        let _ = app.emit(
            SEARCH_INDEX_PROGRESS_EVENT,
            SearchIndexProgressEvent {
                task_id: task_id_for_thread.clone(),
                book_id: task_book_id.clone(),
                stage: SearchIndexProgressStage::Started,
                message: "正在后台重建当前书索引".to_string(),
                summary: None,
                error: None,
            },
        );
        match storage::rebuild_search_index(&db_path, &task_book_id) {
            Ok(summary) => {
                let _ = app.emit(
                    SEARCH_INDEX_PROGRESS_EVENT,
                    SearchIndexProgressEvent {
                        task_id: task_id_for_thread,
                        book_id: task_book_id,
                        stage: SearchIndexProgressStage::Completed,
                        message: "当前书索引已重建".to_string(),
                        summary: Some(summary),
                        error: None,
                    },
                );
            }
            Err(err) => {
                let _ = app.emit(
                    SEARCH_INDEX_PROGRESS_EVENT,
                    SearchIndexProgressEvent {
                        task_id: task_id_for_thread,
                        book_id: task_book_id,
                        stage: SearchIndexProgressStage::Failed,
                        message: "当前书索引重建失败".to_string(),
                        summary: None,
                        error: Some(command_error(err)),
                    },
                );
            }
        }
    });
    Ok(SearchIndexTaskResponse { task_id, book_id })
}

#[command]
pub fn search_index_summary(
    app: AppHandle,
    book_id: String,
) -> CommandResult<storage::SearchIndexSummary> {
    let db_path = library_db_path(&app)?;
    storage::search_index_summary(&db_path, &book_id).map_err(command_error)
}

#[command]
pub fn get_chunk(
    app: AppHandle,
    book_id: String,
    chunk_id: String,
) -> CommandResult<Option<storage::SearchHit>> {
    let db_path = library_db_path(&app)?;
    storage::get_chunk(&db_path, &book_id, &chunk_id).map_err(command_error)
}

#[command]
pub fn get_neighbors(
    app: AppHandle,
    book_id: String,
    chunk_id: String,
    radius: Option<u32>,
) -> CommandResult<Vec<storage::SearchHit>> {
    let db_path = library_db_path(&app)?;
    storage::get_neighbors(&db_path, &book_id, &chunk_id, radius.unwrap_or(1))
        .map_err(command_error)
}

#[command]
pub fn list_structure(app: AppHandle, book_id: String) -> CommandResult<Vec<storage::SearchHit>> {
    let db_path = library_db_path(&app)?;
    storage::list_structure(&db_path, &book_id).map_err(command_error)
}

#[command]
pub fn list_books(app: AppHandle) -> CommandResult<Vec<storage::StoredBookSummary>> {
    let db_path = library_db_path(&app)?;
    storage::list_books(&db_path).map_err(command_error)
}

#[command]
pub fn get_converted_book(
    app: AppHandle,
    book_id: String,
) -> CommandResult<storage::StoredBookAsset> {
    let db_path = library_db_path(&app)?;
    storage::get_converted_book(&db_path, &book_id).map_err(command_error)
}

#[command]
pub fn get_converted_book_manifest(
    app: AppHandle,
    book_id: String,
) -> CommandResult<storage::StoredBookSummary> {
    let db_path = library_db_path(&app)?;
    storage::get_converted_book_manifest(&db_path, &book_id).map_err(command_error)
}

#[command]
pub fn get_converted_book_pages(
    app: AppHandle,
    book_id: String,
    start_page: u32,
    page_count: u32,
) -> CommandResult<storage::StoredBookPageWindow> {
    let db_path = library_db_path(&app)?;
    storage::get_converted_book_pages(&db_path, &book_id, start_page, page_count)
        .map_err(command_error)
}

#[command]
pub fn find_book_by_source_pdf(
    app: AppHandle,
    pdf_path: String,
) -> CommandResult<Option<storage::StoredBookSummary>> {
    let db_path = library_db_path(&app)?;
    storage::find_book_by_source_pdf(&db_path, std::path::Path::new(&pdf_path))
        .map_err(command_error)
}

#[command]
pub fn save_highlight(
    app: AppHandle,
    request: storage::SaveHighlightRequest,
) -> CommandResult<storage::SavedHighlight> {
    let db_path = library_db_path(&app)?;
    storage::save_highlight(&db_path, request).map_err(command_error)
}

#[command]
pub fn list_highlights(
    app: AppHandle,
    book_id: String,
) -> CommandResult<Vec<storage::SavedHighlight>> {
    let db_path = library_db_path(&app)?;
    storage::list_highlights(&db_path, &book_id).map_err(command_error)
}

#[command]
pub fn delete_highlight(app: AppHandle, highlight_id: String) -> CommandResult<()> {
    let db_path = library_db_path(&app)?;
    storage::delete_highlight(&db_path, &highlight_id).map_err(command_error)
}

#[command]
pub fn delete_book(app: AppHandle, book_id: String) -> CommandResult<storage::DeleteBookResponse> {
    let db_path = library_db_path(&app)?;
    storage::delete_book(&db_path, &book_id).map_err(command_error)
}

#[command]
pub fn save_interpretation(
    app: AppHandle,
    request: storage::SaveInterpretationRequest,
) -> CommandResult<storage::SavedInterpretation> {
    let db_path = library_db_path(&app)?;
    storage::save_interpretation(&db_path, request).map_err(command_error)
}

#[command]
pub fn list_interpretations(
    app: AppHandle,
    book_id: String,
    limit: Option<u32>,
    offset: Option<u32>,
) -> CommandResult<Vec<storage::SavedInterpretation>> {
    let db_path = library_db_path(&app)?;
    storage::list_interpretations_page(&db_path, &book_id, limit, offset).map_err(command_error)
}

#[command]
pub fn list_knowledge_cards(
    app: AppHandle,
    book_id: String,
) -> CommandResult<Vec<knowledge::KnowledgeCard>> {
    let db_path = library_db_path(&app)?;
    knowledge::list_cards(&db_path, &book_id).map_err(command_error)
}

#[command]
pub fn get_knowledge_card(
    app: AppHandle,
    book_id: String,
    card_id: String,
) -> CommandResult<Option<knowledge::KnowledgeCard>> {
    let db_path = library_db_path(&app)?;
    knowledge::get_card(&db_path, &book_id, &card_id).map_err(command_error)
}

#[command]
pub async fn get_or_generate_highlight_note(
    app: AppHandle,
    book_id: String,
    card_id: String,
    force: Option<bool>,
) -> CommandResult<knowledge::KnowledgeCard> {
    let db_path = library_db_path(&app)?;
    knowledge::get_or_generate_highlight_note(&db_path, &book_id, &card_id, force.unwrap_or(false))
        .await
        .map_err(command_error)
}

#[command]
pub async fn get_or_generate_card_summary(
    app: AppHandle,
    book_id: String,
    card_id: String,
    force: Option<bool>,
) -> CommandResult<knowledge::KnowledgeCard> {
    let db_path = library_db_path(&app)?;
    knowledge::get_or_generate_card_summary(&db_path, &book_id, &card_id, force.unwrap_or(false))
        .await
        .map_err(command_error)
}

#[command]
pub fn upsert_knowledge_card(
    app: AppHandle,
    request: knowledge::UpsertKnowledgeCardRequest,
) -> CommandResult<knowledge::KnowledgeCard> {
    let db_path = library_db_path(&app)?;
    knowledge::upsert_user_card(&db_path, request).map_err(command_error)
}

#[command]
pub fn confirm_knowledge_card(
    app: AppHandle,
    book_id: String,
    card_id: String,
) -> CommandResult<knowledge::KnowledgeCard> {
    let db_path = library_db_path(&app)?;
    knowledge::confirm_card(&db_path, &book_id, &card_id).map_err(command_error)
}

#[command]
pub fn reject_knowledge_card(
    app: AppHandle,
    book_id: String,
    card_id: String,
) -> CommandResult<knowledge::KnowledgeCard> {
    let db_path = library_db_path(&app)?;
    knowledge::reject_card(&db_path, &book_id, &card_id).map_err(command_error)
}

#[command]
pub fn delete_knowledge_card(
    app: AppHandle,
    book_id: String,
    card_id: String,
) -> CommandResult<()> {
    let db_path = library_db_path(&app)?;
    knowledge::delete_card(&db_path, &book_id, &card_id).map_err(command_error)
}

#[command]
pub fn list_knowledge_cards_by_chunk(
    app: AppHandle,
    book_id: String,
    chunk_id: String,
) -> CommandResult<Vec<knowledge::KnowledgeCard>> {
    let db_path = library_db_path(&app)?;
    knowledge::list_cards_by_chunk(&db_path, &book_id, &chunk_id).map_err(command_error)
}

#[command]
pub fn build_knowledge_graph(
    app: AppHandle,
    book_id: String,
) -> CommandResult<knowledge::BuildKnowledgeGraphResponse> {
    let db_path = library_db_path(&app)?;
    knowledge::build_knowledge_graph(&db_path, &book_id).map_err(command_error)
}

#[command]
pub fn get_knowledge_graph(
    app: AppHandle,
    book_id: String,
) -> CommandResult<knowledge::KnowledgeGraphResponse> {
    let db_path = library_db_path(&app)?;
    knowledge::get_knowledge_graph(&db_path, &book_id).map_err(command_error)
}

#[command]
pub fn get_book_knowledge_map(
    app: AppHandle,
    book_id: String,
) -> CommandResult<knowledge::KnowledgeMapResponse> {
    let db_path = library_db_path(&app)?;
    knowledge::get_book_knowledge_map(&db_path, &book_id).map_err(command_error)
}

#[command]
pub fn knowledge_health(
    app: AppHandle,
    book_id: String,
) -> CommandResult<knowledge::KnowledgeHealth> {
    let db_path = library_db_path(&app)?;
    knowledge::knowledge_health(&db_path, &book_id).map_err(command_error)
}

#[command]
pub fn list_knowledge_drift(
    app: AppHandle,
    book_id: String,
) -> CommandResult<Vec<knowledge::KnowledgeDrift>> {
    let db_path = library_db_path(&app)?;
    knowledge::list_drift(&db_path, &book_id).map_err(command_error)
}

#[command]
pub fn search_knowledge(
    app: AppHandle,
    book_id: String,
    query: String,
    limit: Option<u32>,
) -> CommandResult<Vec<knowledge::KnowledgeSearchHit>> {
    let db_path = library_db_path(&app)?;
    knowledge::search_knowledge(&db_path, &book_id, &query, limit.unwrap_or(8))
        .map_err(command_error)
}

#[command]
pub fn export_book_knowledge_markdown(
    app: AppHandle,
    book_id: String,
) -> CommandResult<knowledge::ExportBookKnowledgeMarkdownResponse> {
    let db_path = library_db_path(&app)?;
    knowledge::export_book_knowledge_markdown(&db_path, &book_id).map_err(command_error)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianExportResponse {
    pub path: String,
}

#[command]
pub fn get_obsidian_settings() -> CommandResult<crate::config::ObsidianSettingsResponse> {
    crate::config::get_obsidian_settings().map_err(command_error)
}

#[command]
pub fn save_obsidian_settings(
    request: crate::config::SaveObsidianSettingsRequest,
) -> CommandResult<crate::config::ObsidianSettingsResponse> {
    crate::config::save_obsidian_settings(request).map_err(command_error)
}

#[command]
pub fn export_snippet_to_obsidian(
    app: AppHandle,
    book_id: String,
    snippet: obsidian::ObsidianSnippet,
) -> CommandResult<ObsidianExportResponse> {
    let target = require_obsidian_config()?;
    let db_path = library_db_path(&app)?;
    let book = storage::get_converted_book_manifest(&db_path, &book_id).map_err(command_error)?;
    let path = obsidian::export_snippet(
        &target.vault_path,
        &target.subdir,
        &book_id,
        &book.title,
        &snippet,
    )
    .map_err(command_error)?;
    Ok(ObsidianExportResponse {
        path: path.to_string_lossy().to_string(),
    })
}

#[command]
pub fn export_book_knowledge_to_obsidian(
    app: AppHandle,
    book_id: String,
) -> CommandResult<ObsidianExportResponse> {
    let target = require_obsidian_config()?;
    let db_path = library_db_path(&app)?;
    let book = storage::get_converted_book_manifest(&db_path, &book_id).map_err(command_error)?;
    let export =
        knowledge::export_book_knowledge_markdown(&db_path, &book_id).map_err(command_error)?;
    let path = obsidian::export_generated_document(
        &target.vault_path,
        &target.subdir,
        &book.title,
        "知识图谱",
        &export.markdown,
    )
    .map_err(command_error)?;
    Ok(ObsidianExportResponse {
        path: path.to_string_lossy().to_string(),
    })
}

fn require_obsidian_config() -> Result<crate::config::ObsidianConfig, CommandError> {
    crate::config::obsidian_config()
        .map_err(command_error)?
        .ok_or_else(|| {
            CommandError::from_message("Obsidian vault 未配置,请先在设置中填写 vault 路径")
        })
}

#[command]
pub fn export_book_knowledge_json(
    app: AppHandle,
    book_id: String,
) -> CommandResult<knowledge::ExportBookKnowledgeJsonResponse> {
    let db_path = library_db_path(&app)?;
    knowledge::export_book_knowledge_json(&db_path, &book_id).map_err(command_error)
}

#[command]
pub async fn get_or_generate_document_tldr(
    app: AppHandle,
    book_id: String,
    force_regenerate: Option<bool>,
) -> CommandResult<storage::DocumentTldr> {
    let db_path = library_db_path(&app)?;
    storage::get_converted_book_manifest(&db_path, &book_id).map_err(command_error)?;
    if force_regenerate != Some(true) {
        if let Some(cached) = storage::get_book_tldr(&db_path, &book_id).map_err(command_error)? {
            if cached.source_version == storage::TLDR_SOURCE_VERSION {
                return Ok(cached);
            }
        }
    }
    let text = interpretation::generate_document_tldr(&db_path, &book_id)
        .await
        .map_err(command_error)?;
    let model = llm::active_model_label().map_err(command_error)?;
    storage::save_book_tldr(
        &db_path,
        &book_id,
        &text,
        &model,
        storage::TLDR_SOURCE_VERSION,
    )
    .map_err(command_error)
}

#[command]
pub fn delete_interpretation(app: AppHandle, interpretation_id: String) -> CommandResult<()> {
    let db_path = library_db_path(&app)?;
    storage::delete_interpretation(&db_path, &interpretation_id).map_err(command_error)
}

#[command]
pub async fn interpret_selection(
    app: AppHandle,
    request: interpretation::InterpretRequest,
    request_id: Option<String>,
) -> CommandResult<interpretation::InterpretResponse> {
    let db_path = library_db_path(&app)?;
    if let Some(request_id) = request_id.filter(|value| !value.trim().is_empty()) {
        interpretation::interpret_with_progress(app, request_id, &db_path, request)
            .await
            .map_err(command_error)
    } else {
        interpretation::interpret(&db_path, request)
            .await
            .map_err(command_error)
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
) -> CommandResult<translation::TranslationStatus> {
    let db_path = library_db_path(&app)?;
    if translation::is_translation_running(&request.book_id) {
        return translation::translation_status(&db_path, &request.book_id).map_err(command_error);
    }
    let book_id = request.book_id.clone();
    storage::get_converted_book_manifest(&db_path, &book_id).map_err(command_error)?;
    translation::translation_status(&db_path, &book_id).map_err(command_error)?;
    tauri::async_runtime::spawn(async move {
        if let Err(error) = translation::start_translation(&db_path, request).await {
            eprintln!("translation job failed: {error:#}");
        }
    });
    translation::translation_status(&library_db_path(&app)?, &book_id).map_err(command_error)
}

#[command]
pub fn translation_status(
    app: AppHandle,
    book_id: String,
) -> CommandResult<translation::TranslationStatus> {
    let db_path = library_db_path(&app)?;
    translation::translation_status(&db_path, &book_id).map_err(command_error)
}

#[command]
pub fn cancel_translation(book_id: String) -> bool {
    translation::cancel_translation(&book_id)
}

/// Expose agent-engine status to the frontend. `hostUrl` is always null since
/// the Codex engine runs per-request (no long-lived server); the AI workbench
/// falls back to its built-in runner until it gets a codex bridge command.
#[command]
pub fn get_agent_host_url() -> crate::agent_host::AgentHostStatus {
    crate::agent_host::status()
}

fn library_db_path(app: &AppHandle) -> CommandResult<std::path::PathBuf> {
    let app_data_dir = app.path().app_data_dir().ok();
    storage::default_db_path(app_data_dir).map_err(command_error)
}

fn resolve_book_asset_path(
    db_path: &std::path::Path,
    book_id: &str,
    kind: BookAssetKind,
) -> CommandResult<std::path::PathBuf> {
    let asset = storage::get_converted_book_manifest(db_path, book_id).map_err(command_error)?;
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
                .ok_or_else(|| CommandError::from("converted asset has no parent directory"))?
        }
    };
    if path.as_os_str().is_empty() {
        return Err(CommandError::not_found(
            "requested book asset is not available",
        ));
    }
    if !path.exists() {
        return Err(CommandError::not_found(format!(
            "book asset does not exist: {}",
            path.display()
        )));
    }
    Ok(path)
}

fn first_non_empty_path(paths: &[String]) -> CommandResult<std::path::PathBuf> {
    paths
        .iter()
        .find(|path| !path.trim().is_empty())
        .map(std::path::PathBuf::from)
        .ok_or_else(|| CommandError::from("converted book has no local asset path"))
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

fn validate_external_https_url(url: &str) -> CommandResult<String> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|_| CommandError::validation("只能打开有效的 HTTPS 外部链接"))?;
    if parsed.scheme() != "https" {
        return Err(CommandError::validation("只能打开 HTTPS 外部链接"));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| CommandError::validation("外部链接缺少 host"))?;
    if !external_url_host_is_allowed(host) {
        return Err(CommandError::validation(format!(
            "外部链接 host 不在允许列表：{host}"
        )));
    }
    Ok(parsed.as_str().to_string())
}

fn external_url_host_is_allowed(host: &str) -> bool {
    matches!(
        host.to_ascii_lowercase().as_str(),
        "platform.deepseek.com"
            | "platform.openai.com"
            | "console.anthropic.com"
            | "mineru.net"
            | "cloud.siliconflow.cn"
    )
}

fn launch_open_path(path: &std::path::Path) -> CommandResult<()> {
    launch_path(path, false)
}

fn launch_reveal_path(path: &std::path::Path) -> CommandResult<()> {
    launch_path(path, true)
}

#[cfg(target_os = "macos")]
fn launch_path(path: &std::path::Path, reveal: bool) -> CommandResult<()> {
    let mut command = std::process::Command::new("open");
    if reveal && path.is_file() {
        command.arg("-R");
    }
    command.arg(path);
    spawn_launch_command(command)
}

#[cfg(target_os = "windows")]
fn launch_path(path: &std::path::Path, reveal: bool) -> CommandResult<()> {
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
fn launch_path(path: &std::path::Path, reveal: bool) -> CommandResult<()> {
    let target = if reveal && path.is_file() {
        path.parent().unwrap_or(path)
    } else {
        path
    };
    let mut command = std::process::Command::new("xdg-open");
    command.arg(target);
    spawn_launch_command(command)
}

fn spawn_launch_command(mut command: std::process::Command) -> CommandResult<()> {
    command
        .spawn()
        .map(|_| ())
        .map_err(|err| CommandError::from_message(format!("failed to open local asset: {err}")))
}

#[cfg(target_os = "macos")]
fn launch_external_url(url: &str) -> CommandResult<()> {
    let mut command = std::process::Command::new("open");
    command.arg(url);
    spawn_external_launch_command(command)
}

#[cfg(target_os = "windows")]
fn launch_external_url(url: &str) -> CommandResult<()> {
    let mut command = std::process::Command::new("cmd");
    command.arg("/C").arg("start").arg("").arg(url);
    spawn_external_launch_command(command)
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn launch_external_url(url: &str) -> CommandResult<()> {
    let mut command = std::process::Command::new("xdg-open");
    command.arg(url);
    spawn_external_launch_command(command)
}

fn spawn_external_launch_command(mut command: std::process::Command) -> CommandResult<()> {
    command
        .spawn()
        .map(|_| ())
        .map_err(|err| CommandError::from_message(format!("failed to open external URL: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_error_classification_adds_actionable_suggestions() {
        let token_error = CommandError::from_message("MinerU API Token is missing");
        assert_eq!(token_error.code, "mineru_token");
        assert!(token_error
            .suggestion
            .is_some_and(|suggestion| suggestion.contains("MinerU API Token")));

        let network_error = CommandError::from_message("connection timed out");
        assert_eq!(network_error.code, "timeout");
        assert!(network_error
            .suggestion
            .is_some_and(|suggestion| suggestion.contains("稍后重试")));
    }

    #[test]
    fn external_url_validation_allows_only_known_https_key_hosts() {
        assert_eq!(
            validate_external_https_url("https://console.anthropic.com/settings/keys").unwrap(),
            "https://console.anthropic.com/settings/keys"
        );
        assert!(validate_external_https_url("http://console.anthropic.com/settings/keys").is_err());
        assert!(
            validate_external_https_url("https://console.anthropic.com.evil/settings/keys")
                .is_err()
        );
        assert!(validate_external_https_url("https://example.com/settings/keys").is_err());
    }
}
