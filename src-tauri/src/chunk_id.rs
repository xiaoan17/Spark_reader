pub const LEGACY_CHUNK_ID_VERSION: u32 = 1;
pub const NAMESPACED_CHUNK_ID_VERSION: u32 = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChunkLocator {
    pub page_number: u32,
    pub chunk_number: u32,
    pub content_hash: Option<String>,
}

pub fn book_namespace(book_id: &str) -> String {
    let hash = hash_hex8(book_id);
    format!("b{hash}")
}

pub fn make_chunk_id(
    book_namespace: &str,
    page_index: u32,
    chunk_index: u32,
    text: &str,
) -> String {
    let safe_namespace = if is_book_namespace(book_namespace) {
        book_namespace.to_ascii_lowercase()
    } else {
        book_namespace_from_seed(book_namespace)
    };
    format!(
        "{}-p{}-c{}-{}",
        safe_namespace,
        page_index + 1,
        chunk_index + 1,
        hash_hex8(&normalize_for_hash(text))
    )
}

pub fn rewrite_chunk_markdown(markdown: &str, old_chunk_id: &str, new_chunk_id: &str) -> String {
    markdown.replace(&format!("[{old_chunk_id}]"), &format!("[{new_chunk_id}]"))
}

pub fn is_namespaced_chunk_id(value: &str) -> bool {
    let Some((book_part, rest)) = value.split_once("-p") else {
        return false;
    };
    if !is_book_namespace(book_part) {
        return false;
    }
    let Some((page, rest)) = rest.split_once("-c") else {
        return false;
    };
    let Some((chunk, hash)) = rest.rsplit_once('-') else {
        return false;
    };
    !page.is_empty()
        && !chunk.is_empty()
        && page.chars().all(|ch| ch.is_ascii_digit())
        && chunk.chars().all(|ch| ch.is_ascii_digit())
        && hash.len() == 8
        && hash.chars().all(|ch| ch.is_ascii_hexdigit())
}

pub fn is_legacy_chunk_id(value: &str) -> bool {
    let Some(rest) = value.strip_prefix('p') else {
        return false;
    };
    let Some((page, chunk)) = rest.split_once("-c") else {
        return false;
    };
    !page.is_empty()
        && !chunk.is_empty()
        && page.chars().all(|ch| ch.is_ascii_digit())
        && chunk.chars().all(|ch| ch.is_ascii_digit())
}

pub fn locator_from_chunk_id(value: &str) -> Option<ChunkLocator> {
    if is_namespaced_chunk_id(value) {
        let (_, rest) = value.split_once("-p")?;
        let (page, rest) = rest.split_once("-c")?;
        let (chunk, hash) = rest.rsplit_once('-')?;
        return Some(ChunkLocator {
            page_number: page.parse().ok()?,
            chunk_number: chunk.parse().ok()?,
            content_hash: Some(hash.to_ascii_lowercase()),
        });
    }
    if is_legacy_chunk_id(value) {
        let rest = value.strip_prefix('p')?;
        let (page, chunk) = rest.split_once("-c")?;
        return Some(ChunkLocator {
            page_number: page.parse().ok()?,
            chunk_number: chunk.parse().ok()?,
            content_hash: None,
        });
    }
    None
}

fn is_book_namespace(value: &str) -> bool {
    value.len() == 9
        && value.starts_with('b')
        && value[1..].chars().all(|ch| ch.is_ascii_hexdigit())
}

fn book_namespace_from_seed(seed: &str) -> String {
    format!("b{}", hash_hex8(seed))
}

fn normalize_for_hash(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn hash_hex8(value: &str) -> String {
    let mut high = 0xdead_beefu32;
    let mut low = 0x41c6_ce57u32;
    for unit in value.encode_utf16() {
        let value = u32::from(unit);
        high = (high ^ value).wrapping_mul(2_654_435_761);
        low = (low ^ value).wrapping_mul(1_597_334_677);
    }
    let mixed_high = (high ^ (high >> 16)).wrapping_mul(2_246_822_507);
    let mixed_low = (low ^ (low >> 13)).wrapping_mul(3_266_489_909);
    format!("{:08x}", mixed_high ^ mixed_low)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_and_validates_namespaced_chunk_ids() {
        let namespace = book_namespace("book-123");
        let chunk_id = make_chunk_id(&namespace, 0, 2, "复利 来自 时间");

        assert!(is_namespaced_chunk_id(&chunk_id));
        assert!(chunk_id.starts_with(&format!("{namespace}-p1-c3-")));
        assert_eq!(hash_hex8("book-123"), "88a20f70");
        assert_eq!(
            make_chunk_id("book-123", 2, 4, "复利 来自 时间"),
            "b88a20f70-p3-c5-2a84c8da"
        );
        assert!(!is_namespaced_chunk_id("p1-c1"));
        assert!(is_legacy_chunk_id("p12-c3"));
        assert!(!is_legacy_chunk_id("page-12"));
        assert_eq!(
            locator_from_chunk_id("b88a20f70-p3-c5-2a84c8da"),
            Some(ChunkLocator {
                page_number: 3,
                chunk_number: 5,
                content_hash: Some("2a84c8da".to_string()),
            })
        );
        assert_eq!(
            locator_from_chunk_id("p12-c3"),
            Some(ChunkLocator {
                page_number: 12,
                chunk_number: 3,
                content_hash: None,
            })
        );
    }

    #[test]
    fn rewrites_only_bracketed_markdown_chunk_id() {
        assert_eq!(
            rewrite_chunk_markdown(
                "### [p1-c1] Page 1\n\np1-c1 body",
                "p1-c1",
                "b12345678-p1-c1-abcdef12"
            ),
            "### [b12345678-p1-c1-abcdef12] Page 1\n\np1-c1 body"
        );
    }
}
