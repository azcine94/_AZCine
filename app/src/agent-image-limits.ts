/** Limits apply to original image bytes; base64 needs four bytes per three. */
export const MAX_AGENT_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_AGENT_IMAGES = 4;
export const MAX_AGENT_IMAGE_BASE64_BYTES = Math.ceil(MAX_AGENT_IMAGE_BYTES / 3) * 4;
export const MAX_AGENT_IMAGE_BATCH_BASE64_BYTES = MAX_AGENT_IMAGES * MAX_AGENT_IMAGE_BASE64_BYTES;
