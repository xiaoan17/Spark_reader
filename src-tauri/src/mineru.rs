use std::{
    fs,
    io::{Cursor, Read},
    path::{Component, Path, PathBuf},
    time::Duration,
};

use anyhow::{Context, Result};
use reqwest::{
    header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE},
    Url,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use thiserror::Error;
use tokio::time::sleep;
use zip::ZipArchive;

use crate::config;

pub const MINERU_PROGRESS_EVENT: &str = "mineru://progress";
const MINERU_CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const MINERU_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const MINERU_UPLOAD_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinerUParseOptions {
    pub is_ocr: bool,
    pub language: String,
    pub model_version: String,
    pub enable_formula: bool,
    pub enable_table: bool,
    pub page_ranges: Option<String>,
}

impl Default for MinerUParseOptions {
    fn default() -> Self {
        Self {
            is_ocr: false,
            language: "ch".to_string(),
            model_version: "vlm".to_string(),
            enable_formula: true,
            enable_table: true,
            page_ranges: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinerUSubmitResponse {
    pub batch_id: String,
    pub upload_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinerUResultItem {
    pub state: String,
    pub full_zip_url: Option<String>,
    pub err_msg: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinerUImportJob {
    pub batch_id: String,
    pub output_dir: String,
    pub poll_count: u32,
    pub state: String,
    pub page_range: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinerUConnectionTestResponse {
    pub base_url: String,
    pub ok: bool,
    pub checked: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinerUProgressEvent {
    pub stage: MinerUProgressStage,
    pub message: String,
    pub batch_id: Option<String>,
    pub poll_count: u32,
    pub state: Option<String>,
    pub batch_index: Option<u32>,
    pub batch_total: Option<u32>,
    pub page_range: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MinerUProgressStage {
    Preparing,
    Submitted,
    Uploaded,
    Polling,
    Downloading,
    Extracting,
    Normalizing,
    Parsing,
    Indexed,
    Failed,
}

pub type ProgressCallback<'a> = dyn Fn(MinerUProgressEvent) + Send + Sync + 'a;

pub const MAX_PAGES_PER_BATCH: usize = 200;

#[derive(Debug, Error)]
pub enum MinerUError {
    #[error(transparent)]
    Config(#[from] config::ConfigError),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error("invalid auth header")]
    InvalidHeader,
    #[error("MinerU returned {code}: {message}")]
    Api { code: i64, message: String },
    #[error("MinerU response missing field {0}")]
    MissingField(&'static str),
    #[error("MinerU parse failed: {0}")]
    Failed(String),
    #[error("MinerU polling timed out")]
    Timeout,
    #[error("unsafe zip entry path")]
    UnsafeZipPath,
    #[error("unsafe MinerU zip download URL: {0}")]
    UnsafeZipUrl(String),
    #[error("MinerU zip response has unexpected Content-Type: {0}")]
    UnexpectedZipContentType(String),
}

#[derive(Debug, Deserialize)]
struct FileUrlsResponse {
    code: i64,
    msg: Option<String>,
    data: Option<FileUrlsData>,
}

#[derive(Debug, Deserialize)]
struct FileUrlsData {
    batch_id: String,
    file_urls: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ExtractResultsResponse {
    code: i64,
    msg: Option<String>,
    data: Option<ExtractResultsData>,
}

#[derive(Debug, Deserialize)]
struct ExtractResultsData {
    extract_result: Vec<ExtractResultItemRaw>,
}

#[derive(Debug, Deserialize)]
struct ExtractResultItemRaw {
    state: String,
    full_zip_url: Option<String>,
    err_msg: Option<String>,
}

pub async fn submit_local_pdf_with_progress(
    pdf_path: &Path,
    options: MinerUParseOptions,
    progress: Option<&ProgressCallback<'_>>,
) -> Result<MinerUSubmitResponse, MinerUError> {
    let config = config::mineru_config()?;
    let file_name = pdf_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("book.pdf");
    emit_progress(
        progress,
        progress_event(
            MinerUProgressStage::Preparing,
            format!("正在向 MinerU 申请上传链接：{file_name}"),
            None,
            0,
            None,
        )
        .with_page_range(options.page_ranges.clone()),
    );
    let client = mineru_http_client(MINERU_REQUEST_TIMEOUT)?;
    let body = file_urls_payload(file_name, &options);
    let response = client
        .post(format!(
            "{}/api/v4/file-urls/batch",
            config.base_url.trim_end_matches('/')
        ))
        .headers(mineru_headers(&config.api_token)?)
        .json(&body)
        .send()
        .await?;

    let status = response.status();
    let text = response.text().await?;
    let parsed: FileUrlsResponse = serde_json::from_str(&text).map_err(|_| MinerUError::Api {
        code: status.as_u16().into(),
        message: text.clone(),
    })?;
    if parsed.code != 0 {
        return Err(MinerUError::Api {
            code: parsed.code,
            message: parsed.msg.unwrap_or_default(),
        });
    }
    let data = parsed.data.ok_or(MinerUError::MissingField("data"))?;
    let upload_url = data
        .file_urls
        .into_iter()
        .next()
        .ok_or(MinerUError::MissingField("file_urls[0]"))?;
    emit_progress(
        progress,
        progress_event(
            MinerUProgressStage::Submitted,
            "已获得 MinerU 上传链接，开始上传 PDF".to_string(),
            Some(data.batch_id.clone()),
            0,
            Some("submitted".to_string()),
        )
        .with_page_range(options.page_ranges.clone()),
    );
    let bytes = std::fs::read(pdf_path)
        .with_context(|| format!("failed to read {}", pdf_path.display()))
        .map_err(|err| MinerUError::Api {
            code: -1,
            message: err.to_string(),
        })?;
    client
        .put(&upload_url)
        .timeout(MINERU_UPLOAD_TIMEOUT)
        .body(bytes)
        .send()
        .await?
        .error_for_status()?;
    emit_progress(
        progress,
        progress_event(
            MinerUProgressStage::Uploaded,
            "PDF 已上传，等待 MinerU 解析".to_string(),
            Some(data.batch_id.clone()),
            0,
            Some("uploaded".to_string()),
        )
        .with_page_range(options.page_ranges.clone()),
    );

    Ok(MinerUSubmitResponse {
        batch_id: data.batch_id,
        upload_url,
    })
}

pub async fn fetch_batch_result(batch_id: &str) -> Result<Vec<MinerUResultItem>, MinerUError> {
    let config = config::mineru_config()?;
    fetch_batch_result_with_config(&config, batch_id).await
}

async fn fetch_batch_result_with_config(
    config: &config::MinerUConfig,
    batch_id: &str,
) -> Result<Vec<MinerUResultItem>, MinerUError> {
    let client = mineru_http_client(MINERU_REQUEST_TIMEOUT)?;
    let response = client
        .get(format!(
            "{}/api/v4/extract-results/batch/{}",
            config.base_url.trim_end_matches('/'),
            batch_id
        ))
        .headers(mineru_auth_headers(&config.api_token)?)
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await?;
    let parsed: ExtractResultsResponse =
        serde_json::from_str(&text).map_err(|_| MinerUError::Api {
            code: status.as_u16().into(),
            message: text.clone(),
        })?;
    if parsed.code != 0 {
        return Err(MinerUError::Api {
            code: parsed.code,
            message: parsed.msg.unwrap_or_default(),
        });
    }
    let data = parsed.data.ok_or(MinerUError::MissingField("data"))?;
    Ok(data
        .extract_result
        .into_iter()
        .map(|item| MinerUResultItem {
            state: item.state,
            full_zip_url: item.full_zip_url,
            err_msg: item.err_msg,
        })
        .collect())
}

pub async fn test_connection_with_settings(
    request: config::SaveMinerUSettingsRequest,
) -> Result<MinerUConnectionTestResponse, MinerUError> {
    let config = config::mineru_config_from_request(&request)?;
    let probe_batch_id = "codex-connectivity-probe-not-a-real-batch";
    match fetch_batch_result_with_config(&config, probe_batch_id).await {
        Ok(_) => Ok(MinerUConnectionTestResponse {
            base_url: config.base_url,
            ok: true,
            checked: "extract-results/batch".to_string(),
        }),
        Err(MinerUError::Api { code, message }) if is_batch_probe_auth_success(code, &message) => {
            Ok(MinerUConnectionTestResponse {
                base_url: config.base_url,
                ok: true,
                checked: "extract-results/batch".to_string(),
            })
        }
        Err(error) => Err(error),
    }
}

fn is_batch_probe_auth_success(code: i64, message: &str) -> bool {
    if code == 0 {
        return true;
    }
    let lower = message.to_lowercase();
    let mentions_missing_batch = (lower.contains("batch")
        || lower.contains("batch_id")
        || lower.contains("task")
        || lower.contains("任务")
        || lower.contains("批次"))
        && (lower.contains("not found")
            || lower.contains("not exist")
            || lower.contains("not available")
            || lower.contains("不存在")
            || lower.contains("未找到"));
    mentions_missing_batch
        && !is_mineru_auth_error(code, message)
        && !lower.contains("<html")
        && !lower.contains("<!doctype")
}

fn is_mineru_auth_error(code: i64, message: &str) -> bool {
    let lower = message.to_lowercase();
    matches!(code, 401 | 403)
        || lower.contains("a0202")
        || lower.contains("a0211")
        || lower.contains("token")
        || lower.contains("unauthorized")
        || lower.contains("forbidden")
}

pub async fn parse_pdf_to_output_dir_with_progress(
    pdf_path: &Path,
    output_base_dir: &Path,
    options: MinerUParseOptions,
    progress: Option<&ProgressCallback<'_>>,
) -> Result<MinerUImportJob, MinerUError> {
    let page_range = options.page_ranges.clone();
    let submitted = submit_local_pdf_with_progress(pdf_path, options, progress).await?;
    let mut interval = Duration::from_secs(2);
    let mut poll_count = 0_u32;
    let mut final_item = None;

    while poll_count < 90 {
        poll_count += 1;
        sleep(interval).await;
        let results = fetch_batch_result(&submitted.batch_id).await?;
        let item = match results.into_iter().next() {
            Some(item) => item,
            None => continue,
        };
        emit_progress(
            progress,
            progress_event(
                MinerUProgressStage::Polling,
                format!(
                    "MinerU 解析状态：{}（第 {} 次轮询）",
                    item.state, poll_count
                ),
                Some(submitted.batch_id.clone()),
                poll_count,
                Some(item.state.clone()),
            )
            .with_page_range(page_range.clone()),
        );
        match item.state.as_str() {
            "done" => {
                final_item = Some(item);
                break;
            }
            "failed" => {
                return Err(MinerUError::Failed(
                    item.err_msg
                        .unwrap_or_else(|| "unknown MinerU error".to_string()),
                ));
            }
            _ => {
                interval = (interval + Duration::from_secs(2)).min(Duration::from_secs(10));
            }
        }
    }

    let item = final_item.ok_or(MinerUError::Timeout)?;
    let full_zip_url = item
        .full_zip_url
        .as_deref()
        .ok_or(MinerUError::MissingField("full_zip_url"))?;
    let output_dir = output_base_dir.join(&submitted.batch_id);
    emit_progress(
        progress,
        progress_event(
            MinerUProgressStage::Downloading,
            "MinerU 解析完成，正在下载结果 zip".to_string(),
            Some(submitted.batch_id.clone()),
            poll_count,
            Some(item.state.clone()),
        )
        .with_page_range(page_range.clone()),
    );
    download_and_extract_zip(full_zip_url, &output_dir).await?;
    emit_progress(
        progress,
        progress_event(
            MinerUProgressStage::Extracting,
            "解析结果已下载并解压，正在规范化输出文件".to_string(),
            Some(submitted.batch_id.clone()),
            poll_count,
            Some(item.state.clone()),
        )
        .with_page_range(page_range.clone()),
    );
    normalize_mineru_output_files(&output_dir)?;
    emit_progress(
        progress,
        progress_event(
            MinerUProgressStage::Normalizing,
            "已生成 layout.json/full.md，准备入库".to_string(),
            Some(submitted.batch_id.clone()),
            poll_count,
            Some(item.state.clone()),
        )
        .with_page_range(page_range.clone()),
    );

    Ok(MinerUImportJob {
        batch_id: submitted.batch_id,
        output_dir: output_dir.to_string_lossy().to_string(),
        poll_count,
        state: item.state,
        page_range,
    })
}

pub async fn parse_pdf_to_output_dirs_with_progress(
    pdf_path: &Path,
    output_base_dir: &Path,
    options: MinerUParseOptions,
    page_count: Option<usize>,
    progress: Option<&ProgressCallback<'_>>,
) -> Result<Vec<MinerUImportJob>, MinerUError> {
    if options
        .page_ranges
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return parse_pdf_to_output_dir_with_progress(pdf_path, output_base_dir, options, progress)
            .await
            .map(|job| vec![job]);
    }

    let page_ranges = page_ranges_for_batches(page_count, MAX_PAGES_PER_BATCH);
    if page_ranges.is_empty() {
        return parse_pdf_to_output_dir_with_progress(pdf_path, output_base_dir, options, progress)
            .await
            .map(|job| vec![job]);
    }

    let total_batches = page_ranges.len();
    let mut jobs = Vec::with_capacity(total_batches);
    for (index, page_range) in page_ranges.into_iter().enumerate() {
        emit_progress(
            progress,
            progress_event(
                MinerUProgressStage::Preparing,
                format!(
                    "长 PDF 分批解析：第 {}/{} 批，页码 {}",
                    index + 1,
                    total_batches,
                    page_range
                ),
                None,
                0,
                Some("batched".to_string()),
            )
            .with_batch(index + 1, total_batches)
            .with_page_range(Some(page_range.clone())),
        );
        let mut batch_options = options.clone();
        batch_options.page_ranges = Some(page_range);
        let batch_page_range = batch_options.page_ranges.clone();
        let batch_progress = |mut event: MinerUProgressEvent| {
            event.batch_index = Some((index + 1) as u32);
            event.batch_total = Some(total_batches as u32);
            if event.page_range.is_none() {
                event.page_range = batch_page_range.clone();
            }
            if let Some(callback) = progress {
                callback(event);
            }
        };
        jobs.push(
            parse_pdf_to_output_dir_with_progress(
                pdf_path,
                output_base_dir,
                batch_options,
                Some(&batch_progress),
            )
            .await?,
        );
    }
    Ok(jobs)
}

pub fn emit_progress(progress: Option<&ProgressCallback<'_>>, event: MinerUProgressEvent) {
    if let Some(callback) = progress {
        callback(event);
    }
}

pub fn progress_event(
    stage: MinerUProgressStage,
    message: String,
    batch_id: Option<String>,
    poll_count: u32,
    state: Option<String>,
) -> MinerUProgressEvent {
    MinerUProgressEvent {
        stage,
        message,
        batch_id,
        poll_count,
        state,
        batch_index: None,
        batch_total: None,
        page_range: None,
    }
}

impl MinerUProgressEvent {
    pub fn with_batch(mut self, batch_index: usize, batch_total: usize) -> Self {
        self.batch_index = Some(batch_index as u32);
        self.batch_total = Some(batch_total as u32);
        self
    }

    pub fn with_page_range(mut self, page_range: Option<String>) -> Self {
        self.page_range = page_range.filter(|value| !value.trim().is_empty());
        self
    }
}

pub async fn download_and_extract_zip(url: &str, output_dir: &Path) -> Result<(), MinerUError> {
    validate_mineru_zip_url(url)?;
    let client = mineru_http_client(MINERU_UPLOAD_TIMEOUT)?;
    let response = client.get(url).send().await?.error_for_status()?;
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if !zip_content_type_is_allowed(url, &content_type) {
        return Err(MinerUError::UnexpectedZipContentType(content_type));
    }
    let bytes = response.bytes().await?;
    extract_zip_bytes(&bytes, output_dir)
}

fn validate_mineru_zip_url(url: &str) -> Result<(), MinerUError> {
    let parsed = Url::parse(url).map_err(|err| MinerUError::UnsafeZipUrl(err.to_string()))?;
    if parsed.scheme() != "https" {
        return Err(MinerUError::UnsafeZipUrl(
            "zip download URL must use https".to_string(),
        ));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| MinerUError::UnsafeZipUrl("zip download URL has no host".to_string()))?;
    if !mineru_zip_host_is_allowed(host) {
        return Err(MinerUError::UnsafeZipUrl(format!(
            "zip download host is not allowed: {host}"
        )));
    }
    Ok(())
}

fn mineru_zip_host_is_allowed(host: &str) -> bool {
    let normalized = host.to_ascii_lowercase();
    if DEFAULT_MINERU_ZIP_HOSTS
        .iter()
        .any(|allowed| zip_host_matches_allowed(&normalized, allowed))
    {
        return true;
    }
    std::env::var("MINERU_ALLOWED_ZIP_HOSTS")
        .ok()
        .map(|hosts| {
            hosts.split(',').any(|allowed| {
                let allowed = allowed.trim().trim_start_matches('.').to_ascii_lowercase();
                zip_host_matches_allowed(&normalized, &allowed)
            })
        })
        .unwrap_or(false)
}

const DEFAULT_MINERU_ZIP_HOSTS: &[&str] = &["mineru.net", "cdn-mineru.openxlab.org.cn"];

fn zip_host_matches_allowed(normalized_host: &str, allowed_host: &str) -> bool {
    !allowed_host.is_empty()
        && (normalized_host == allowed_host
            || normalized_host.ends_with(&format!(".{allowed_host}")))
}

fn zip_content_type_is_allowed(url: &str, content_type: &str) -> bool {
    let content_type = content_type.to_ascii_lowercase();
    content_type.contains("zip")
        || content_type.contains("octet-stream")
        || url
            .to_ascii_lowercase()
            .split('?')
            .next()
            .unwrap_or("")
            .ends_with(".zip")
}

fn mineru_http_client(timeout: Duration) -> Result<reqwest::Client, MinerUError> {
    reqwest::Client::builder()
        .https_only(true)
        .connect_timeout(MINERU_CONNECT_TIMEOUT)
        .timeout(timeout)
        .build()
        .map_err(|err| MinerUError::Api {
            code: -1,
            message: err.to_string(),
        })
}

fn extract_zip_bytes(bytes: &[u8], output_dir: &Path) -> Result<(), MinerUError> {
    fs::create_dir_all(output_dir).map_err(|err| MinerUError::Api {
        code: -1,
        message: err.to_string(),
    })?;
    let cursor = Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor).map_err(|err| MinerUError::Api {
        code: -1,
        message: err.to_string(),
    })?;

    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|err| MinerUError::Api {
            code: -1,
            message: err.to_string(),
        })?;
        if zip_entry_is_symlink(file.unix_mode()) {
            return Err(MinerUError::UnsafeZipPath);
        }
        let out_path = safe_zip_output_path(output_dir, file.name())?;
        if file.name().ends_with('/') {
            fs::create_dir_all(&out_path).map_err(|err| MinerUError::Api {
                code: -1,
                message: err.to_string(),
            })?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|err| MinerUError::Api {
                code: -1,
                message: err.to_string(),
            })?;
        }
        reject_symlink_ancestor(output_dir, &out_path)?;
        let mut contents = Vec::new();
        file.read_to_end(&mut contents)
            .map_err(|err| MinerUError::Api {
                code: -1,
                message: err.to_string(),
            })?;
        fs::write(&out_path, contents).map_err(|err| MinerUError::Api {
            code: -1,
            message: err.to_string(),
        })?;
    }

    Ok(())
}

fn zip_entry_is_symlink(mode: Option<u32>) -> bool {
    const UNIX_FILE_TYPE_MASK: u32 = 0o170000;
    const UNIX_SYMLINK_TYPE: u32 = 0o120000;
    mode.is_some_and(|mode| mode & UNIX_FILE_TYPE_MASK == UNIX_SYMLINK_TYPE)
}

fn reject_symlink_ancestor(output_dir: &Path, out_path: &Path) -> Result<(), MinerUError> {
    let mut current = output_dir.to_path_buf();
    let relative = out_path
        .strip_prefix(output_dir)
        .map_err(|_| MinerUError::UnsafeZipPath)?;
    for component in relative.components() {
        if let Component::Normal(part) = component {
            current.push(part);
            if fs::symlink_metadata(&current)
                .map(|metadata| metadata.file_type().is_symlink())
                .unwrap_or(false)
            {
                return Err(MinerUError::UnsafeZipPath);
            }
        }
    }
    Ok(())
}

fn safe_zip_output_path(output_dir: &Path, entry_name: &str) -> Result<PathBuf, MinerUError> {
    let mut path = output_dir.to_path_buf();
    for component in Path::new(entry_name).components() {
        match component {
            Component::Normal(part) => path.push(part),
            Component::CurDir => {}
            _ => return Err(MinerUError::UnsafeZipPath),
        }
    }
    Ok(path)
}

fn normalize_mineru_output_files(output_dir: &Path) -> Result<(), MinerUError> {
    let layout = find_first_file(output_dir, |path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with("middle.json") || name == "layout.json")
    })
    .ok_or(MinerUError::MissingField("layout.json"))?;
    let markdown = find_first_file(output_dir, |path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name == "full.md" || name.ends_with(".md"))
    })
    .ok_or(MinerUError::MissingField("full.md"))?;

    let layout_target = output_dir.join("layout.json");
    if layout != layout_target {
        fs::copy(&layout, &layout_target).map_err(|err| MinerUError::Api {
            code: -1,
            message: err.to_string(),
        })?;
    }
    let markdown_target = output_dir.join("full.md");
    if markdown != markdown_target {
        fs::copy(&markdown, &markdown_target).map_err(|err| MinerUError::Api {
            code: -1,
            message: err.to_string(),
        })?;
    }
    Ok(())
}

fn find_first_file<F>(dir: &Path, predicate: F) -> Option<PathBuf>
where
    F: Fn(&Path) -> bool + Copy,
{
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_first_file(&path, predicate) {
                return Some(found);
            }
        } else if predicate(&path) {
            return Some(path);
        }
    }
    None
}

fn file_urls_payload(file_name: &str, options: &MinerUParseOptions) -> serde_json::Value {
    let mut file = json!({
        "name": file_name,
        "is_ocr": options.is_ocr,
        "data_id": file_name,
    });
    if let Some(page_ranges) = options
        .page_ranges
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        file["page_ranges"] = json!(page_ranges);
    }

    json!({
        "enable_formula": options.enable_formula,
        "enable_table": options.enable_table,
        "language": options.language,
        "model_version": options.model_version,
        "files": [file],
    })
}

pub fn page_ranges_for_batches(page_count: Option<usize>, batch_size: usize) -> Vec<String> {
    let Some(page_count) = page_count else {
        return Vec::new();
    };
    if page_count <= batch_size || batch_size == 0 {
        return Vec::new();
    }

    let mut ranges = Vec::new();
    let mut start = 1;
    while start <= page_count {
        let end = (start + batch_size - 1).min(page_count);
        ranges.push(format!("{start}-{end}"));
        start = end + 1;
    }
    ranges
}

fn mineru_headers(api_token: &str) -> Result<HeaderMap, MinerUError> {
    let mut headers = mineru_auth_headers(api_token)?;
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    Ok(headers)
}

fn mineru_auth_headers(api_token: &str) -> Result<HeaderMap, MinerUError> {
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {api_token}"))
            .map_err(|_| MinerUError::InvalidHeader)?,
    );
    Ok(headers)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_file_urls_payload_with_page_ranges() {
        let options = MinerUParseOptions {
            page_ranges: Some("1-10".to_string()),
            ..MinerUParseOptions::default()
        };
        let payload = file_urls_payload("book.pdf", &options);

        assert_eq!(payload["model_version"], "vlm");
        assert_eq!(payload["files"][0]["name"], "book.pdf");
        assert_eq!(payload["files"][0]["page_ranges"], "1-10");
    }

    #[test]
    fn builds_page_ranges_for_long_pdf_batches() {
        assert_eq!(
            page_ranges_for_batches(Some(450), 200),
            vec!["1-200", "201-400", "401-450"]
        );
        assert!(page_ranges_for_batches(Some(200), 200).is_empty());
        assert!(page_ranges_for_batches(None, 200).is_empty());
    }

    #[test]
    fn default_options_match_product_policy() {
        let options = MinerUParseOptions::default();
        assert_eq!(options.language, "ch");
        assert_eq!(options.model_version, "vlm");
        assert!(options.enable_formula);
        assert!(options.enable_table);
    }

    #[test]
    fn treats_missing_probe_batch_as_authenticated_connection() {
        assert!(is_batch_probe_auth_success(404, "batch not found"));
        assert!(is_batch_probe_auth_success(-1, "任务不存在"));
        assert!(is_batch_probe_auth_success(0, ""));
        assert!(!is_batch_probe_auth_success(404, "<html>not found</html>"));
    }

    #[test]
    fn rejects_token_errors_for_connection_probe() {
        assert!(!is_batch_probe_auth_success(401, "unauthorized"));
        assert!(!is_batch_probe_auth_success(-1, "A0202 Token 错误"));
        assert!(!is_batch_probe_auth_success(-1, "A0211 Token 过期"));
    }

    #[test]
    fn rejects_unsafe_zip_paths() {
        let output_dir = Path::new("/tmp/mineru");
        assert!(safe_zip_output_path(output_dir, "../secret").is_err());
        assert!(safe_zip_output_path(output_dir, "/absolute").is_err());
        assert!(safe_zip_output_path(output_dir, "nested/layout.json").is_ok());
    }

    #[test]
    fn rejects_zip_symlink_entries() {
        assert!(zip_entry_is_symlink(Some(0o120777)));
        assert!(!zip_entry_is_symlink(Some(0o100644)));
        assert!(!zip_entry_is_symlink(None));
    }

    #[test]
    fn allows_default_mineru_zip_download_hosts() {
        assert!(mineru_zip_host_is_allowed("mineru.net"));
        assert!(mineru_zip_host_is_allowed("cdn.mineru.net"));
        assert!(mineru_zip_host_is_allowed("cdn-mineru.openxlab.org.cn"));
    }

    #[test]
    fn rejects_unlisted_mineru_zip_download_hosts() {
        assert!(!mineru_zip_host_is_allowed("example.com"));
        assert!(!mineru_zip_host_is_allowed("mineru.net.example.com"));
        assert!(!mineru_zip_host_is_allowed(
            "cdn-mineru.openxlab.org.cn.example.com"
        ));
    }

    #[test]
    fn progress_callback_receives_structured_stage_payload() {
        let events = std::sync::Mutex::new(Vec::new());
        emit_progress(
            Some(&|event| events.lock().unwrap().push(event)),
            progress_event(
                MinerUProgressStage::Polling,
                "MinerU 解析状态：running（第 3 次轮询）".to_string(),
                Some("batch-1".to_string()),
                3,
                Some("running".to_string()),
            )
            .with_batch(2, 4)
            .with_page_range(Some("201-400".to_string())),
        );

        let events = events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].stage, MinerUProgressStage::Polling);
        assert_eq!(events[0].batch_id.as_deref(), Some("batch-1"));
        assert_eq!(events[0].poll_count, 3);
        assert_eq!(events[0].state.as_deref(), Some("running"));
        assert_eq!(events[0].batch_index, Some(2));
        assert_eq!(events[0].batch_total, Some(4));
        assert_eq!(events[0].page_range.as_deref(), Some("201-400"));
    }
}
