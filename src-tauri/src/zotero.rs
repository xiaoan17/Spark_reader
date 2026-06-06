use std::{
    env,
    path::{Path, PathBuf},
    time::Duration,
};

use anyhow::{anyhow, Context, Result};
use reqwest::header::LOCATION;
use serde::{Deserialize, Serialize};

const LOCAL_API_BASE_URL: &str = "http://127.0.0.1:23119/api/users/0";
const MAX_ZOTERO_QUERY_CHARS: usize = 300;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroSearchResult {
    pub item_key: String,
    pub title: String,
    pub creators: Vec<String>,
    pub year: String,
    pub item_type: String,
    pub attachment_key: Option<String>,
    pub attachment_title: Option<String>,
    pub has_pdf: bool,
}

#[derive(Debug, Deserialize)]
struct ZoteroItem {
    key: String,
    #[serde(default)]
    data: ZoteroItemData,
    #[serde(default)]
    meta: ZoteroItemMeta,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ZoteroItemMeta {
    num_children: Option<u32>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ZoteroItemData {
    item_type: String,
    title: Option<String>,
    creators: Option<Vec<ZoteroCreator>>,
    date: Option<String>,
    content_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ZoteroCreator {
    first_name: Option<String>,
    last_name: Option<String>,
    name: Option<String>,
}

pub fn search_items(query: &str, limit: u32) -> Result<Vec<ZoteroSearchResult>> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    if trimmed.chars().count() > MAX_ZOTERO_QUERY_CHARS {
        return Err(anyhow!(
            "Zotero 搜索关键词过长，请控制在 {MAX_ZOTERO_QUERY_CHARS} 个字符以内"
        ));
    }
    let client = client()?;
    let url = format!(
        "{LOCAL_API_BASE_URL}/items?q={}&qmode=titleCreatorYear&limit={}",
        percent_encode(trimmed),
        limit.clamp(1, 20)
    );
    let items: Vec<ZoteroItem> = client
        .get(url)
        .send()
        .context("无法连接 Zotero 本地 API，请确认 Zotero 已打开")?
        .error_for_status()
        .context("Zotero 本地 API 返回错误")?
        .json()
        .context("无法解析 Zotero 搜索结果")?;

    items
        .into_iter()
        .filter(|item| item.data.item_type != "attachment")
        .map(|item| item_to_search_result(&client, item))
        .collect()
}

pub fn resolve_item_pdf_path(item_key: &str) -> Result<ZoteroResolvedPdf> {
    let item_key = item_key.trim();
    if item_key.is_empty() {
        return Err(anyhow!("Zotero item key 不能为空"));
    }
    let client = client()?;
    let item = get_item(&client, item_key)?;
    let attachment_key = if is_pdf_attachment(&item) {
        item.key.clone()
    } else {
        find_pdf_attachment(&client, item_key)?
            .map(|attachment| attachment.key)
            .ok_or_else(|| anyhow!("Zotero 条目没有本地 PDF 附件"))?
    };
    let pdf_path = attachment_file_path(&client, &attachment_key)?;
    Ok(ZoteroResolvedPdf {
        pdf_path,
        title: item.data.title.unwrap_or_else(|| item_key.to_string()),
    })
}

#[derive(Debug, Clone)]
pub struct ZoteroResolvedPdf {
    pub pdf_path: PathBuf,
    pub title: String,
}

fn client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .context("failed to build Zotero API client")
}

fn item_to_search_result(
    client: &reqwest::blocking::Client,
    item: ZoteroItem,
) -> Result<ZoteroSearchResult> {
    let attachment = if item.meta.num_children.unwrap_or(0) > 0 {
        find_pdf_attachment(client, &item.key)?
    } else {
        None
    };
    let creators = item
        .data
        .creators
        .unwrap_or_default()
        .into_iter()
        .map(format_creator)
        .filter(|creator| !creator.is_empty())
        .collect::<Vec<_>>();
    let year = item
        .data
        .date
        .as_deref()
        .and_then(extract_year)
        .unwrap_or_default()
        .to_string();
    let attachment_key = attachment.as_ref().map(|attachment| attachment.key.clone());
    let attachment_title = attachment
        .as_ref()
        .and_then(|attachment| attachment.data.title.clone());
    let has_pdf = attachment.is_some();
    Ok(ZoteroSearchResult {
        item_key: item.key,
        title: item
            .data
            .title
            .unwrap_or_else(|| "未命名 Zotero 条目".to_string()),
        creators,
        year,
        item_type: item.data.item_type,
        attachment_key,
        attachment_title,
        has_pdf,
    })
}

fn get_item(client: &reqwest::blocking::Client, item_key: &str) -> Result<ZoteroItem> {
    client
        .get(format!("{LOCAL_API_BASE_URL}/items/{item_key}"))
        .send()
        .context("无法连接 Zotero 本地 API，请确认 Zotero 已打开")?
        .error_for_status()
        .with_context(|| format!("Zotero 条目不存在：{item_key}"))?
        .json()
        .with_context(|| format!("无法解析 Zotero 条目：{item_key}"))
}

fn find_pdf_attachment(
    client: &reqwest::blocking::Client,
    item_key: &str,
) -> Result<Option<ZoteroItem>> {
    let children: Vec<ZoteroItem> = client
        .get(format!("{LOCAL_API_BASE_URL}/items/{item_key}/children"))
        .send()
        .context("无法读取 Zotero 条目的附件")?
        .error_for_status()
        .with_context(|| format!("无法读取 Zotero 条目附件：{item_key}"))?
        .json()
        .with_context(|| format!("无法解析 Zotero 条目附件：{item_key}"))?;
    Ok(children.into_iter().find(is_pdf_attachment))
}

fn is_pdf_attachment(item: &ZoteroItem) -> bool {
    item.data.item_type == "attachment"
        && item
            .data
            .content_type
            .as_deref()
            .is_some_and(|content_type| content_type.eq_ignore_ascii_case("application/pdf"))
}

fn attachment_file_path(
    client: &reqwest::blocking::Client,
    attachment_key: &str,
) -> Result<PathBuf> {
    let response = client
        .get(format!("{LOCAL_API_BASE_URL}/items/{attachment_key}/file"))
        .send()
        .context("无法读取 Zotero PDF 文件路径")?;
    let location = response
        .headers()
        .get(LOCATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| anyhow!("Zotero 没有返回本地 PDF 路径"))?;
    file_url_to_path(location)
        .with_context(|| format!("Zotero PDF 路径无效：{location}"))
        .and_then(|path| {
            let canonical = path
                .canonicalize()
                .with_context(|| format!("Zotero PDF 文件不存在：{}", path.display()))?;
            ensure_path_under_zotero_storage(&canonical)?;
            if canonical.exists() {
                Ok(canonical)
            } else {
                Err(anyhow!("Zotero PDF 文件不存在：{}", canonical.display()))
            }
        })
}

fn file_url_to_path(value: &str) -> Result<PathBuf> {
    let encoded = value
        .strip_prefix("file://")
        .ok_or_else(|| anyhow!("Zotero 返回的不是本地 file:// 路径"))?;
    let decoded = percent_decode(encoded)?;
    Ok(PathBuf::from(decoded))
}

fn ensure_path_under_zotero_storage(path: &Path) -> Result<()> {
    let Some(storage_dir) = env::var("ZOTERO_STORAGE_DIR")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
    else {
        return Ok(());
    };
    let storage_dir = storage_dir
        .canonicalize()
        .with_context(|| format!("Zotero storage 目录不存在：{}", storage_dir.display()))?;
    if !path.starts_with(&storage_dir) {
        return Err(anyhow!(
            "Zotero PDF 路径不在允许的 storage 目录下：{}",
            path.display()
        ));
    }
    Ok(())
}

fn percent_encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn percent_decode(value: &str) -> Result<String> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return Err(anyhow!("incomplete percent escape"));
            }
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3])
                .context("invalid percent escape")?;
            output.push(u8::from_str_radix(hex, 16).context("invalid percent escape")?);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(output).context("file URL is not valid UTF-8")
}

fn format_creator(creator: ZoteroCreator) -> String {
    if let Some(name) = creator.name {
        return name.trim().to_string();
    }
    [creator.first_name, creator.last_name]
        .into_iter()
        .flatten()
        .map(|part| part.trim().to_string())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn extract_year(value: &str) -> Option<&str> {
    value
        .as_bytes()
        .windows(4)
        .position(|window| window.iter().all(u8::is_ascii_digit))
        .map(|index| &value[index..index + 4])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_zotero_file_url() {
        let path = file_url_to_path(
            "file:///Users/anbc/Zotero%E6%96%87%E7%8C%AE/storage/SICPQR3S/Liu%20%E7%AD%89.pdf",
        )
        .expect("file URL should decode");
        assert_eq!(
            path.to_string_lossy(),
            "/Users/anbc/Zotero文献/storage/SICPQR3S/Liu 等.pdf"
        );
    }

    #[test]
    fn encodes_search_query() {
        assert_eq!(
            percent_encode("RiskNet 长尾"),
            "RiskNet%20%E9%95%BF%E5%B0%BE"
        );
    }

    #[test]
    fn extracts_year_from_dateish_string() {
        assert_eq!(extract_year("March 2026"), Some("2026"));
        assert_eq!(extract_year("n.d."), None);
    }
}
