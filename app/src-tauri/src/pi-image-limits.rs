//! App-owned image limits. Native Pi retains its own model image processing.
pub(crate) const MAX_IMAGE_BYTES: usize = 50 * 1024 * 1024;
pub(crate) const MAX_IMAGES: usize = 4;
pub(crate) const MAX_IMAGE_BASE64_BYTES: usize = ((MAX_IMAGE_BYTES + 2) / 3) * 4;
pub(crate) const MAX_IMAGE_BATCH_BASE64_BYTES: usize = MAX_IMAGES * MAX_IMAGE_BASE64_BYTES;
// Allow the image payload plus existing non-image message/context overhead.
pub(crate) const MAX_IMAGE_RPC_BYTES: usize = MAX_IMAGE_BATCH_BASE64_BYTES + 16 * 1024 * 1024;
pub(crate) const MAX_IMAGE_HISTORY_BYTES: usize = MAX_IMAGE_RPC_BYTES + 64 * 1024 * 1024;

pub(crate) fn image_encoded_size_allowed(data: &str) -> bool {
    if data.is_empty() || data.len() > MAX_IMAGE_BASE64_BYTES || data.len() % 4 != 0 { return false; }
    let padding = if data.ends_with("==") { 2 } else if data.ends_with('=') { 1 } else { 0 };
    data.len() / 4 * 3 - padding <= MAX_IMAGE_BYTES
}
