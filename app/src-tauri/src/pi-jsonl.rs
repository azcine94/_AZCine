use std::io::{self, Write};

use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrameError {
    pub code: &'static str,
    pub message: &'static str,
}

const INVALID_LIMIT: FrameError = FrameError {
    code: "invalid_limit",
    message: "记录字节上限必须大于零。",
};

const RECORD_TOO_LARGE: FrameError = FrameError {
    code: "record_too_large",
    message: "JSON 记录超过字节上限。",
};

const INVALID_UTF8: FrameError = FrameError {
    code: "invalid_utf8",
    message: "JSON 记录不是有效的 UTF-8。",
};

const INVALID_JSON: FrameError = FrameError {
    code: "invalid_json",
    message: "JSON 记录格式无效。",
};

const TRUNCATED_JSON: FrameError = FrameError {
    code: "truncated_json",
    message: "JSON 记录不完整。",
};

const RECORD_NOT_OBJECT: FrameError = FrameError {
    code: "record_not_object",
    message: "JSON 记录必须是对象。",
};

const INVALID_TYPE: FrameError = FrameError {
    code: "invalid_type",
    message: "JSON 记录的 type 必须是非空字符串。",
};

const DECODER_FAILED: FrameError = FrameError {
    code: "decoder_failed",
    message: "解码器已失败，不能继续读取。",
};

const ALLOCATION_FAILED: FrameError = FrameError {
    code: "allocation_failed",
    message: "无法分配 JSON 记录缓冲区。",
};

const ENCODE_FAILED: FrameError = FrameError {
    code: "encode_failed",
    message: "无法编码 JSON 命令。",
};

/// LF-only JSONL decoder.
///
/// A possible trailing CR is held separately until the following byte or EOF.
/// Consequently, the record buffer does not need an extra byte beyond the
/// configured limit. Returned values are caller-owned, not retained here.
pub struct JsonlDecoder {
    max_record_bytes: usize,
    buffer: Vec<u8>,
    pending_cr: bool,
    failed: bool,
}

impl JsonlDecoder {
    pub fn new(max_record_bytes: usize) -> Result<Self, FrameError> {
        if max_record_bytes == 0 {
            return Err(INVALID_LIMIT);
        }

        Ok(Self {
            max_record_bytes,
            buffer: Vec::new(),
            pending_cr: false,
            failed: false,
        })
    }

    /// Consumes arbitrary byte chunks, emitting only complete LF-ended records.
    ///
    /// An error rejects this call's entire batch and permanently poisons the
    /// decoder. Records returned by earlier successful calls remain unchanged.
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<Value>, FrameError> {
        if self.failed {
            return Err(DECODER_FAILED);
        }

        let mut records = Vec::new();

        for &byte in chunk {
            let result = if byte == b'\n' {
                self.take_record()
            } else {
                self.append_byte(byte).map(|()| None)
            };

            match result {
                Ok(Some(record)) => records.push(record),
                Ok(None) => {}
                Err(error) => return self.fail(error),
            }
        }

        Ok(records)
    }

    /// Consumes a final record without LF, or ignores a JSON-whitespace tail.
    ///
    /// Successful calls empty the pending record. The caller owns the stream's
    /// EOF lifecycle; this method does not introduce a separate closed state.
    pub fn finish(&mut self) -> Result<Vec<Value>, FrameError> {
        if self.failed {
            return Err(DECODER_FAILED);
        }

        match self.take_record() {
            Ok(record) => Ok(record.into_iter().collect()),
            Err(error) => self.fail(error),
        }
    }

    fn append_byte(&mut self, byte: u8) -> Result<(), FrameError> {
        // The preceding CR is not a terminator if another non-LF byte follows.
        if self.pending_cr {
            append_bounded(&mut self.buffer, b"\r", self.max_record_bytes)?;
            self.pending_cr = false;
        }

        if byte == b'\r' {
            self.pending_cr = true;
            Ok(())
        } else {
            append_bounded(&mut self.buffer, &[byte], self.max_record_bytes)
        }
    }

    fn take_record(&mut self) -> Result<Option<Value>, FrameError> {
        // Drop exactly one optional CR immediately before LF or EOF.
        self.pending_cr = false;
        let result = parse_record(&self.buffer);
        self.buffer.clear();
        result
    }

    fn fail<T>(&mut self, error: FrameError) -> Result<T, FrameError> {
        self.failed = true;
        self.buffer.clear();
        self.pending_cr = false;
        Err(error)
    }
}

/// Encodes one compact UTF-8 JSON object followed by exactly one LF.
///
/// The limit applies to serialized record bytes, excluding the appended LF.
/// Serialization is bounded while writing, not checked only after allocating
/// the complete encoded command.
pub fn encode_command(
    record: &Value,
    max_record_bytes: usize,
) -> Result<Vec<u8>, FrameError> {
    if max_record_bytes == 0 {
        return Err(INVALID_LIMIT);
    }
    validate_record(record)?;

    let mut writer = CommandWriter {
        buffer: Vec::new(),
        max_record_bytes,
        failure: None,
    };

    if serde_json::to_writer(&mut writer, record).is_err() {
        return Err(writer.failure.unwrap_or(ENCODE_FAILED));
    }

    writer
        .buffer
        .try_reserve_exact(1)
        .map_err(|_| ALLOCATION_FAILED)?;
    writer.buffer.push(b'\n');

    Ok(writer.buffer)
}

fn validate_record(record: &Value) -> Result<(), FrameError> {
    let object = record.as_object().ok_or(RECORD_NOT_OBJECT)?;

    // Do not enumerate, trim, rename, or otherwise modify upstream types.
    match object.get("type").and_then(Value::as_str) {
        Some(kind) if !kind.is_empty() => Ok(()),
        _ => Err(INVALID_TYPE),
    }
}

fn parse_record(bytes: &[u8]) -> Result<Option<Value>, FrameError> {
    let text = std::str::from_utf8(bytes).map_err(|_| INVALID_UTF8)?;

    // LF is handled by framing. Only JSON whitespace is ignored here;
    // Unicode separators and other Unicode whitespace are not delimiters.
    if bytes
        .iter()
        .all(|&byte| matches!(byte, b' ' | b'\t' | b'\r'))
    {
        return Ok(None);
    }

    let record: Value = serde_json::from_str(text).map_err(|error| {
        if error.is_eof() {
            TRUNCATED_JSON
        } else {
            INVALID_JSON
        }
    })?;

    validate_record(&record)?;
    Ok(Some(record))
}

/// Checks the raw length before growing or copying into the buffer.
///
/// Growth requests are capped at the configured limit, rather than allowing
/// Vec's normal geometric growth to request space beyond that limit.
fn append_bounded(
    buffer: &mut Vec<u8>,
    bytes: &[u8],
    max_record_bytes: usize,
) -> Result<(), FrameError> {
    let required = buffer
        .len()
        .checked_add(bytes.len())
        .filter(|&length| length <= max_record_bytes)
        .ok_or(RECORD_TOO_LARGE)?;

    if required > buffer.capacity() {
        let target = required
            .max(buffer.capacity().saturating_mul(2))
            .max(64)
            .min(max_record_bytes);

        buffer
            .try_reserve_exact(target - buffer.len())
            .map_err(|_| ALLOCATION_FAILED)?;
    }

    buffer.extend_from_slice(bytes);
    Ok(())
}

struct CommandWriter {
    buffer: Vec<u8>,
    max_record_bytes: usize,
    failure: Option<FrameError>,
}

impl Write for CommandWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.failure.is_some() {
            return Err(io::Error::other("JSONL encoding stopped."));
        }

        match append_bounded(&mut self.buffer, bytes, self.max_record_bytes) {
            Ok(()) => Ok(bytes.len()),
            Err(error) => {
                self.failure = Some(error);
                Err(io::Error::other("JSONL encoding stopped."))
            }
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn assert_poisoned(decoder: &mut JsonlDecoder) {
        assert_eq!(decoder.push(&[]).unwrap_err(), DECODER_FAILED);
        assert_eq!(
            decoder.push(b"{\"type\":\"later\"}\n").unwrap_err(),
            DECODER_FAILED
        );
        assert_eq!(decoder.finish().unwrap_err(), DECODER_FAILED);
        assert_eq!(decoder.finish().unwrap_err(), DECODER_FAILED);
        assert!(decoder.buffer.is_empty());
        assert!(!decoder.pending_cr);
    }

    #[test]
    fn given_zero_limit_when_constructing_or_encoding_then_rejects_the_limit() {
        let error = JsonlDecoder::new(0)
            .err()
            .expect("a zero byte limit must fail");
        assert_eq!(error, INVALID_LIMIT);
        assert_eq!(
            encode_command(&json!({ "type": "prompt" }), 0).unwrap_err(),
            INVALID_LIMIT
        );
    }

    #[test]
    fn given_large_limit_when_constructing_then_does_not_allocate_it_eagerly() {
        let mut decoder = JsonlDecoder::new(usize::MAX).unwrap();

        assert_eq!(decoder.buffer.capacity(), 0);
        assert_eq!(
            decoder.push(b"{\"type\":\"event\"}\n").unwrap(),
            vec![json!({ "type": "event" })]
        );
        assert!(decoder.finish().unwrap().is_empty());
    }

    #[test]
    fn given_utf8_and_unicode_separators_when_split_at_every_boundary_then_preserves_text() {
        let text = "中文🙂\u{2028}中间\u{2029}末尾";
        let expected = json!({
            "type": "future_event",
            "text": text
        });
        let wire =
            format!("{{\"type\":\"future_event\",\"text\":\"{text}\"}}\n").into_bytes();
        let limit = wire.len() - 1;

        for split in 0..=wire.len() {
            let mut decoder = JsonlDecoder::new(limit).unwrap();
            let mut records = decoder.push(&wire[..split]).unwrap();
            records.extend(decoder.push(&wire[split..]).unwrap());
            records.extend(decoder.finish().unwrap());

            assert_eq!(records, vec![expected.clone()], "split at byte {split}");
        }

        let mut decoder = JsonlDecoder::new(limit).unwrap();
        let mut records = Vec::new();
        for chunk in wire.chunks(1) {
            records.extend(decoder.push(chunk).unwrap());
        }
        records.extend(decoder.finish().unwrap());

        assert_eq!(records, vec![expected]);
    }

    #[test]
    fn given_crlf_and_multiple_records_when_chunks_split_crlf_then_preserves_order() {
        let mut decoder = JsonlDecoder::new(64).unwrap();

        assert!(decoder.push(b"\r").unwrap().is_empty());
        assert!(decoder.push(b"\n \t\r").unwrap().is_empty());
        assert!(
            decoder
                .push(b"\n{\"type\":\"one\"}\r")
                .unwrap()
                .is_empty()
        );

        assert_eq!(
            decoder
                .push(b"\n\n{\"type\":\"two\"}\n{\"type\":\"three\"}")
                .unwrap(),
            vec![json!({ "type": "one" }), json!({ "type": "two" })]
        );
        assert_eq!(
            decoder.finish().unwrap(),
            vec![json!({ "type": "three" })]
        );
        assert!(decoder.finish().unwrap().is_empty());
    }

    #[test]
    fn given_complete_record_at_limit_when_ended_by_lf_crlf_or_eof_then_accepts_it() {
        let raw = b" \t{\"type\":\"event\"} ";
        let endings: &[&[u8]] = &[b"", b"\n", b"\r", b"\r\n"];

        for &ending in endings {
            let mut wire = raw.to_vec();
            wire.extend_from_slice(ending);

            let mut decoder = JsonlDecoder::new(raw.len()).unwrap();
            let mut records = Vec::new();

            for chunk in wire.chunks(1) {
                records.extend(decoder.push(chunk).unwrap());
                assert!(decoder.buffer.len() <= raw.len());
                assert!(decoder.buffer.capacity() <= raw.len());
            }
            records.extend(decoder.finish().unwrap());

            assert_eq!(records, vec![json!({ "type": "event" })]);
            assert!(decoder.finish().unwrap().is_empty());
        }
    }

    #[test]
    fn given_json_whitespace_when_terminated_or_finished_then_ignores_it() {
        let mut decoder = JsonlDecoder::new(3).unwrap();

        assert!(decoder.push(b"\n\r\n \t\r\n").unwrap().is_empty());
        assert!(decoder.push(b"   \r").unwrap().is_empty());
        assert!(decoder.finish().unwrap().is_empty());
        assert!(decoder.finish().unwrap().is_empty());
    }

    #[test]
    fn given_truncated_json_when_finishing_then_reports_truncation_and_poison() {
        let cases: &[&[u8]] = &[
            b"{\"type\":\"event\"",
            b"{\"type\":\"event\",\"text\":\"unfinished",
            b"{\"type\":\"event\",\"data\":[",
        ];

        for &raw in cases {
            let mut decoder = JsonlDecoder::new(128).unwrap();

            assert!(decoder.push(raw).unwrap().is_empty());
            assert_eq!(decoder.finish().unwrap_err(), TRUNCATED_JSON);
            assert_poisoned(&mut decoder);
        }
    }

    #[test]
    fn given_invalid_records_when_terminated_or_finished_then_rejects_and_poison() {
        let cases: &[(&[u8], &str)] = &[
            (b"not-json", "invalid_json"),
            (b"{\"type\":\"event\",}", "invalid_json"),
            (b"{\"type\":\"event\"}junk", "invalid_json"),
            (
                b"{\"type\":\"one\"}{\"type\":\"two\"}",
                "invalid_json",
            ),
            (b"[]", "record_not_object"),
            (b"null", "record_not_object"),
            (b"false", "record_not_object"),
            (b"7", "record_not_object"),
            (b"\"event\"", "record_not_object"),
            (b"{}", "invalid_type"),
            (b"{\"Type\":\"event\"}", "invalid_type"),
            (b"{\"type\":\"\"}", "invalid_type"),
            (b"{\"type\":null}", "invalid_type"),
            (b"{\"type\":true}", "invalid_type"),
            (b"{\"type\":42}", "invalid_type"),
            (b"{\"type\":[]}", "invalid_type"),
            (b"{\"type\":{}}", "invalid_type"),
            (
                b"{\"type\":\"event\",\"text\":\"\xff\"}",
                "invalid_utf8",
            ),
            (
                b"{\"type\":\"event\",\"text\":\"\xf0\x9f",
                "invalid_utf8",
            ),
        ];

        for &(raw, expected_code) in cases {
            for terminated in [false, true] {
                let mut decoder = JsonlDecoder::new(256).unwrap();

                let error = if terminated {
                    let mut wire = raw.to_vec();
                    wire.push(b'\n');
                    decoder.push(&wire).unwrap_err()
                } else {
                    assert!(decoder.push(raw).unwrap().is_empty());
                    decoder.finish().unwrap_err()
                };

                assert_eq!(error.code, expected_code);
                assert_poisoned(&mut decoder);
            }
        }
    }

    #[test]
    fn given_non_lf_separators_when_outside_json_strings_then_does_not_split_or_ignore() {
        for separator in ["\u{2028}", "\u{2029}", "\u{00a0}", "\x0b", "\x0c"] {
            let mut decoder = JsonlDecoder::new(64).unwrap();
            let wire = format!("{separator}\n");

            assert_eq!(
                decoder.push(wire.as_bytes()).unwrap_err(),
                INVALID_JSON
            );
            assert_poisoned(&mut decoder);
        }

        let mut decoder = JsonlDecoder::new(64).unwrap();
        assert_eq!(
            decoder
                .push(b"{\"type\":\"one\"}\r{\"type\":\"two\"}\n")
                .unwrap_err(),
            INVALID_JSON
        );
        assert_poisoned(&mut decoder);
    }

    #[test]
    fn given_internal_cr_when_followed_by_json_content_then_counts_it_as_record_data() {
        let raw = b"{\"type\":\r\"event\"}";
        let mut decoder = JsonlDecoder::new(raw.len()).unwrap();

        assert!(decoder.push(b"{\"type\":\r").unwrap().is_empty());
        assert_eq!(
            decoder.push(b"\"event\"}\n").unwrap(),
            vec![json!({ "type": "event" })]
        );

        let mut too_small = JsonlDecoder::new(raw.len() - 1).unwrap();
        assert_eq!(too_small.push(raw).unwrap_err(), RECORD_TOO_LARGE);
        assert_poisoned(&mut too_small);
    }

    #[test]
    fn given_bad_record_between_valid_records_when_pushed_then_fails_the_batch() {
        let mut decoder = JsonlDecoder::new(64).unwrap();

        assert_eq!(
            decoder.push(b"{\"type\":\"previous\"}\n").unwrap(),
            vec![json!({ "type": "previous" })]
        );
        assert_eq!(
            decoder
                .push(b"{\"type\":\"early\"}\n[]\n{\"type\":\"later\"}\n")
                .unwrap_err(),
            RECORD_NOT_OBJECT
        );
        assert_poisoned(&mut decoder);
    }

    #[test]
    fn given_record_over_limit_when_received_whole_or_split_then_fails_before_growth() {
        let raw = b"{\"type\":\"event\"}";
        let limit = raw.len() - 1;

        let mut whole = JsonlDecoder::new(limit).unwrap();
        assert_eq!(whole.push(raw).unwrap_err(), RECORD_TOO_LARGE);
        assert!(whole.buffer.capacity() <= limit);
        assert_poisoned(&mut whole);

        let mut split = JsonlDecoder::new(limit).unwrap();
        assert!(split.push(&raw[..limit]).unwrap().is_empty());
        assert_eq!(
            split.push(&raw[limit..]).unwrap_err(),
            RECORD_TOO_LARGE
        );
        assert!(split.buffer.capacity() <= limit);
        assert_poisoned(&mut split);
    }

    #[test]
    fn given_full_record_and_pending_cr_when_more_non_lf_arrives_then_cr_counts() {
        let raw = b"{\"type\":\"event\"}";

        for next in [b'x', b'\r'] {
            let mut decoder = JsonlDecoder::new(raw.len()).unwrap();

            assert!(decoder.push(raw).unwrap().is_empty());
            assert!(decoder.push(b"\r").unwrap().is_empty());
            assert_eq!(decoder.buffer.len(), raw.len());
            assert_eq!(decoder.push(&[next]).unwrap_err(), RECORD_TOO_LARGE);
            assert_poisoned(&mut decoder);
        }
    }

    #[test]
    fn given_oversized_whitespace_when_received_then_checks_length_before_ignoring() {
        let cases: &[&[u8]] = &[b"    \n", b"    ", b"\r\r\r\r\r\n"];

        for &wire in cases {
            let mut decoder = JsonlDecoder::new(3).unwrap();

            assert_eq!(decoder.push(wire).unwrap_err(), RECORD_TOO_LARGE);
            assert_poisoned(&mut decoder);
        }
    }

    #[test]
    fn given_large_unterminated_chunk_when_received_then_keeps_buffer_bounded() {
        let limit = 17;
        let chunk = vec![b'x'; 65_536];
        let mut decoder = JsonlDecoder::new(limit).unwrap();

        assert_eq!(decoder.push(&chunk).unwrap_err(), RECORD_TOO_LARGE);
        assert!(decoder.buffer.capacity() <= limit);
        assert_poisoned(&mut decoder);
    }

    #[test]
    fn given_many_short_records_in_large_chunk_when_received_then_limits_each_record() {
        let raw = b"{\"type\":\"tick\"}";
        let mut line = raw.to_vec();
        line.push(b'\n');
        let chunk = line.repeat(4096);

        let mut decoder = JsonlDecoder::new(raw.len()).unwrap();
        let records = decoder.push(&chunk).unwrap();

        assert!(chunk.len() > raw.len());
        assert_eq!(records.len(), 4096);
        assert!(
            records
                .iter()
                .all(|record| record == &json!({ "type": "tick" }))
        );
        assert!(decoder.buffer.is_empty());
        assert!(decoder.buffer.capacity() <= raw.len());
        assert!(decoder.finish().unwrap().is_empty());
    }

    #[test]
    fn given_unicode_record_when_limit_counts_characters_then_rejects_excess_bytes() {
        let raw = "{\"type\":\"event\",\"text\":\"中文🙂\"}";
        let character_count = raw.chars().count();
        assert!(raw.len() > character_count);

        let mut decoder = JsonlDecoder::new(character_count).unwrap();

        assert_eq!(
            decoder.push(raw.as_bytes()).unwrap_err(),
            RECORD_TOO_LARGE
        );
        assert_poisoned(&mut decoder);
    }

    #[test]
    fn given_command_with_unicode_and_newlines_when_encoded_then_round_trips_unchanged() {
        let command = json!({
            "type": "future_custom_command",
            "text": "中文🙂\u{2028}\u{2029}\n下一行\r\n\"引号\"\\",
            "extra": {
                "enabled": true,
                "items": [1, null, "值"]
            }
        });
        let original = command.clone();
        let compact = serde_json::to_vec(&command).unwrap();

        let encoded = encode_command(&command, compact.len()).unwrap();
        let mut expected_wire = compact.clone();
        expected_wire.push(b'\n');

        assert_eq!(encoded, expected_wire);
        assert_eq!(encoded.last(), Some(&b'\n'));
        assert_eq!(encoded.iter().filter(|&&byte| byte == b'\n').count(), 1);
        assert!(encoded.windows(2).any(|pair| pair == b"\\n"));
        assert_eq!(command, original);

        let mut decoder = JsonlDecoder::new(compact.len()).unwrap();
        let mut records = Vec::new();
        for chunk in encoded.chunks(3) {
            records.extend(decoder.push(chunk).unwrap());
        }
        records.extend(decoder.finish().unwrap());

        assert_eq!(records, vec![original]);
        assert!(records[0].get("id").is_none());
    }

    #[test]
    fn given_encoded_command_at_limit_when_limit_is_reduced_then_rejects_without_mutation() {
        let command = json!({
            "type": "prompt",
            "message": "中🙂\n"
        });
        let original = command.clone();
        let compact = serde_json::to_vec(&command).unwrap();

        assert_eq!(
            encode_command(&command, compact.len()).unwrap().len(),
            compact.len() + 1
        );
        assert_eq!(
            encode_command(&command, compact.len() - 1).unwrap_err(),
            RECORD_TOO_LARGE
        );
        assert_eq!(command, original);
    }

    #[test]
    fn given_invalid_command_shape_when_encoding_then_rejects_object_or_type() {
        let cases = [
            (json!(null), RECORD_NOT_OBJECT),
            (json!(true), RECORD_NOT_OBJECT),
            (json!(7), RECORD_NOT_OBJECT),
            (json!("event"), RECORD_NOT_OBJECT),
            (json!([]), RECORD_NOT_OBJECT),
            (json!({}), INVALID_TYPE),
            (json!({ "type": "" }), INVALID_TYPE),
            (json!({ "type": null }), INVALID_TYPE),
            (json!({ "type": false }), INVALID_TYPE),
            (json!({ "type": 42 }), INVALID_TYPE),
            (json!({ "type": [] }), INVALID_TYPE),
            (json!({ "type": {} }), INVALID_TYPE),
        ];

        for (command, expected_error) in cases {
            assert_eq!(
                encode_command(&command, 256).unwrap_err(),
                expected_error
            );
        }
    }

    #[test]
    fn given_sensitive_fixture_content_when_errors_occur_then_messages_never_echo_it() {
        let marker = "fixture-sensitive-marker";
        let cases: &[(&[u8], usize)] = &[
            (
                b"{\"type\":\"\",\"text\":\"fixture-sensitive-marker\"}\n",
                256,
            ),
            (
                b"{\"type\":\"fixture-sensitive-marker\",\"text\":}\n",
                256,
            ),
            (
                b"{\"type\":\"event\",\"text\":\"fixture-sensitive-marker\xff\"}\n",
                256,
            ),
            (
                b"{\"type\":\"event\",\"text\":\"fixture-sensitive-marker\"}\n",
                8,
            ),
        ];

        for &(wire, limit) in cases {
            let mut decoder = JsonlDecoder::new(limit).unwrap();
            let error = decoder.push(wire).unwrap_err();

            assert!(!error.message.contains(marker));
            assert!(!format!("{error:?}").contains(marker));
            assert_poisoned(&mut decoder);
        }

        let command = json!({
            "type": "",
            "text": marker
        });
        let error = encode_command(&command, 256).unwrap_err();
        assert!(!error.message.contains(marker));
        assert!(!format!("{error:?}").contains(marker));
    }
}
