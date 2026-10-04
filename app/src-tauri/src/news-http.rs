// Public RSS/Atom GETs only. No browser cookies, authentication or process-wide proxy changes.
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use url::{Host, Url};
use crate::storage::StorageError;

pub const MAX_FEED_BYTES: usize = 4 * 1024 * 1024;
#[derive(Debug, Clone)]
pub struct FeedResponse { pub body: Vec<u8>, pub url: String, pub fetched_at: String }

pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => public_v4(ip),
        IpAddr::V6(ip) => {
            let segments = ip.segments();
            // Global unicast only; exclude transition, documentation and protocol-assignment ranges.
            (segments[0] & 0xe000) == 0x2000 && segments[0] != 0x2002
                && !(segments[0] == 0x2001 && (segments[1] <= 0x01ff || segments[1] == 0x0db8))
                && !(segments[0] == 0x3fff && segments[1] <= 0x0fff)
                && ip.to_ipv4_mapped().is_none() && ip != Ipv6Addr::UNSPECIFIED
        }
    }
}
fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !matches!(a, 0 | 10 | 127) && a < 224
        && !(a == 100 && (64..=127).contains(&b))
        && !(a == 169 && b == 254) && !(a == 172 && (16..=31).contains(&b))
        && !(a == 192 && (b == 168 || b == 0 && (c == 0 || c == 2) || b == 88 && c == 99))
        && !(a == 198 && (b == 18 || b == 19 || b == 51 && c == 100))
        && !(a == 203 && b == 0 && c == 113)
}
fn invalid() -> StorageError { StorageError::new("unsupported_feed_url", "仅支持公开 HTTP/HTTPS 订阅地址（80/443端口），不支持本机/内网、登录、凭据或其他协议；输入已保留。") }
pub fn public_url(value: &str) -> Result<Url, StorageError> {
    if value.len() > 4096 || value.chars().any(|c| c.is_control()) { return Err(invalid()); }
    let url = Url::parse(value).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some()
        || url.fragment().is_some() || url.port_or_known_default() != Some(if url.scheme() == "https" { 443 } else { 80 }) {
        return Err(invalid());
    }
    match url.host().ok_or_else(invalid)? {
        Host::Ipv4(ip) if public_ip(ip.into()) => {},
        Host::Ipv6(ip) if public_ip(ip.into()) => {},
        Host::Domain(host) => {
            let host = host.trim_end_matches('.').to_ascii_lowercase();
            if !host.contains('.') || ["localhost", "local", "internal", "lan", "home", "test", "invalid", "example"].iter()
                .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}"))) { return Err(invalid()); }
        },
        _ => return Err(invalid()),
    }
    if url.query_pairs().any(|(key, _)| matches!(key.to_ascii_lowercase().as_str(), "key" | "api_key" | "apikey" | "token" | "access_token" | "password" | "authorization")) {
        return Err(invalid());
    }
    Ok(url)
}
pub fn fetch(value: &str) -> Result<FeedResponse, StorageError> {
    let url = public_url(value)?;
    #[cfg(windows)]
    { windows_http::fetch(url) }
    #[cfg(not(windows))]
    { let _ = url; Err(StorageError::new("feed_platform_unsupported", "资讯采集目前仅接入 Windows 桌面版，没有执行采集或保存。")) }
}

#[cfg(windows)]
mod windows_http {
    use super::*;
    use std::ffi::c_void;
    use std::net::ToSocketAddrs;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};
    use windows::Win32::Networking::WinHttp::*;
    use windows::core::{PCWSTR, w};

    struct Handle(*mut c_void);
    impl Handle {
        fn new(value: *mut c_void) -> Result<Self, StorageError> {
            if value.is_null() { Err(network_error()) } else { Ok(Self(value)) }
        }
    }
    impl Drop for Handle { fn drop(&mut self) { unsafe { let _ = WinHttpCloseHandle(self.0); } } }
    fn network_error() -> StorageError {
        StorageError::new("feed_fetch_failed", "订阅直连请求失败：请检查网络、TLS证书或信源可用性。本期不读取系统代理、浏览器登录与宿主认证。")
    }
    fn timeout() -> StorageError { StorageError::new("feed_timeout", "订阅请求超时，未报告采集成功；可稍后重试这个来源。") }
    fn wide(value: &str) -> Vec<u16> { value.encode_utf16().chain(Some(0)).collect() }
    fn option(handle: &Handle, key: u32, bytes: &[u8]) -> Result<(), StorageError> {
        unsafe { WinHttpSetOption(Some(handle.0.cast_const()), key, Some(bytes)) }.map_err(|_| network_error())
    }
    fn header(handle: &Handle, key: u32) -> Result<Option<String>, StorageError> {
        let mut size = 0;
        let first = unsafe { WinHttpQueryHeaders(handle.0, key, PCWSTR::null(), None, &mut size, std::ptr::null_mut()) };
        if first.is_ok() && size == 0 { return Ok(None); }
        if size == 0 { return Ok(None); }
        if size > 16 * 1024 { return Err(StorageError::new("feed_headers_large", "订阅响应头过大，已停止读取。")); }
        let mut buffer = vec![0u16; (size as usize + 1) / 2];
        unsafe { WinHttpQueryHeaders(handle.0, key, PCWSTR::null(), Some(buffer.as_mut_ptr().cast()), &mut size, std::ptr::null_mut()) }
            .map_err(|_| network_error())?;
        let end = buffer.iter().position(|value| *value == 0).unwrap_or(buffer.len());
        String::from_utf16(&buffer[..end]).map(Some).map_err(|_| network_error())
    }
    fn resolve(url: &Url, remaining: Duration) -> Result<IpAddr, StorageError> {
        match url.host().ok_or_else(invalid)? {
            Host::Ipv4(ip) => return Ok(ip.into()), Host::Ipv6(ip) => return Ok(ip.into()), Host::Domain(_) => {},
        }
        let host = url.host_str().ok_or_else(invalid)?.to_owned();
        let port = url.port_or_known_default().ok_or_else(invalid)?;
        let (send, receive) = mpsc::sync_channel(1);
        // The bounded wait also covers DNS. The resolver owns no storage or application PID.
        std::thread::Builder::new().name("azcine-feed-dns".into()).spawn(move || {
            let result = (host.as_str(), port).to_socket_addrs().map(|addresses| addresses.map(|a| a.ip()).collect::<Vec<_>>());
            let _ = send.send(result);
        }).map_err(|_| network_error())?;
        let addresses = receive.recv_timeout(remaining.min(Duration::from_secs(8))).map_err(|_| timeout())?
            .map_err(|_| network_error())?;
        if addresses.is_empty() || addresses.iter().any(|ip| !public_ip(*ip)) { return Err(invalid()); }
        Ok(addresses.iter().copied().find(IpAddr::is_ipv4).unwrap_or(addresses[0]))
    }
    fn remaining(deadline: Instant) -> Result<Duration, StorageError> {
        deadline.checked_duration_since(Instant::now()).filter(|duration| !duration.is_zero()).ok_or_else(timeout)
    }
    fn set_timeout(handle: &Handle, deadline: Instant) -> Result<(), StorageError> {
        let milliseconds = remaining(deadline)?.as_millis().clamp(1, 10_000) as i32;
        unsafe { WinHttpSetTimeouts(handle.0, milliseconds, milliseconds, milliseconds, milliseconds) }.map_err(|_| network_error())
    }
    pub fn fetch(mut url: Url) -> Result<FeedResponse, StorageError> {
        let deadline = Instant::now() + Duration::from_secs(45);
        for redirects in 0..=5 {
            let ip = resolve(&url, remaining(deadline)?)?;
            // A separate direct session prevents proxy/cookie/credential inheritance and cross-request pooling.
            let session = Handle::new(unsafe { WinHttpOpen(w!("AZCine/0.0 RSS reader"), WINHTTP_ACCESS_TYPE_NO_PROXY, PCWSTR::null(), PCWSTR::null(), 0) })?;
            option(&session, WINHTTP_OPTION_DISABLE_GLOBAL_POOLING, &1u32.to_ne_bytes())?;
            set_timeout(&session, deadline)?;
            let host = wide(url.host_str().ok_or_else(invalid)?.trim_matches(['[', ']']));
            let connection = Handle::new(unsafe { WinHttpConnect(session.0, PCWSTR(host.as_ptr()), url.port_or_known_default().ok_or_else(invalid)?, 0) })?;
            let path = wide(&format!("{}{}", url.path(), url.query().map(|query| format!("?{query}")).unwrap_or_default()));
            let flags = if url.scheme() == "https" { WINHTTP_FLAG_SECURE } else { WINHTTP_OPEN_REQUEST_FLAGS(0) };
            let request = Handle::new(unsafe { WinHttpOpenRequest(connection.0, w!("GET"), PCWSTR(path.as_ptr()), PCWSTR::null(), PCWSTR::null(), std::ptr::null(), flags) })?;
            option(&request, WINHTTP_OPTION_DISABLE_FEATURE, &(WINHTTP_DISABLE_REDIRECTS | WINHTTP_DISABLE_COOKIES | WINHTTP_DISABLE_AUTHENTICATION).to_ne_bytes())?;
            // Pin DNS to the already checked address while keeping the original hostname for TLS/SNI/Host.
            // Windows 10 21H1+; unsupported OS/options fail closed instead of requesting an unchecked address.
            let pinned = wide(&ip.to_string());
            let bytes = unsafe { std::slice::from_raw_parts(pinned.as_ptr().cast::<u8>(), pinned.len() * 2) };
            option(&request, WINHTTP_OPTION_RESOLUTION_HOSTNAME, bytes)?;
            option(&request, WINHTTP_OPTION_DECOMPRESSION, &(WINHTTP_DECOMPRESSION_FLAG_GZIP | WINHTTP_DECOMPRESSION_FLAG_DEFLATE).to_ne_bytes())?;
            set_timeout(&request, deadline)?;
            let headers: Vec<u16> = "Accept: application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9\r\n".encode_utf16().collect();
            unsafe { WinHttpSendRequest(request.0, Some(&headers), None, 0, 0, 0) }.map_err(|_| network_error())?;
            set_timeout(&request, deadline)?;
            unsafe { WinHttpReceiveResponse(request.0, std::ptr::null_mut()) }.map_err(|_| network_error())?;
            let status = header(&request, WINHTTP_QUERY_STATUS_CODE)?.and_then(|value| value.parse::<u16>().ok()).ok_or_else(network_error)?;
            if matches!(status, 301 | 302 | 303 | 307 | 308) {
                if redirects == 5 { return Err(StorageError::new("feed_redirect_limit", "订阅重定向超过5次，已停止请求。")); }
                let location = header(&request, WINHTTP_QUERY_LOCATION)?.ok_or_else(network_error)?;
                let next = url.join(&location).map_err(|_| invalid())?;
                public_url(next.as_str())?;
                if url.scheme() == "https" && next.scheme() != "https" { return Err(StorageError::new("feed_insecure_redirect", "HTTPS订阅转向不安全的HTTP地址，已停止请求。")); }
                url = next; continue;
            }
            if !(200..300).contains(&status) { return Err(StorageError::new("feed_http_status", &format!("信源返回 HTTP {status}，未当作正常无新增；不自动登录或绕过访问限制。"))); }
            if header(&request, WINHTTP_QUERY_CONTENT_LENGTH)?.and_then(|value| value.parse::<usize>().ok()).is_some_and(|length| length > MAX_FEED_BYTES) {
                return Err(StorageError::new("feed_too_large", "订阅响应超过4 MiB，已停止读取，原资料保持不变。"));
            }
            let mut body = Vec::new();
            let mut buffer = [0u8; 16 * 1024];
            loop {
                set_timeout(&request, deadline)?;
                let mut count = 0;
                unsafe { WinHttpReadData(request.0, buffer.as_mut_ptr().cast(), buffer.len() as u32, &mut count) }.map_err(|_| network_error())?;
                if count == 0 { break; }
                if body.len() + count as usize > MAX_FEED_BYTES { return Err(StorageError::new("feed_too_large", "解压后的订阅超过4 MiB，已停止读取，原资料保持不变。")); }
                body.extend_from_slice(&buffer[..count as usize]);
            }
            return Ok(FeedResponse { body, url: url.into(), fetched_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true) });
        }
        Err(network_error())
    }
}
