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
// Only an explicitly supplied HTTP proxy; never import system proxy/PAC or credentials.
pub fn proxy_server(value: &str) -> Result<String, StorageError> {
    let invalid = || StorageError::new("news_proxy_invalid", "请填写 HTTP 代理地址，例如 http://127.0.0.1:7890（端口以代理软件为准）。支持 HTTP / Mixed 端口，不支持 SOCKS、登录凭据、路径或查询参数；输入保留。");
    if value.len() > 512 || value.chars().any(|c| c.is_control()) { return Err(invalid()); }
    let proxy = Url::parse(value.trim()).map_err(|_| invalid())?;
    if proxy.scheme() != "http" || !proxy.username().is_empty() || proxy.password().is_some()
        || proxy.path() != "/" || proxy.query().is_some() || proxy.fragment().is_some() {
        return Err(invalid());
    }
    let host = match proxy.host().ok_or_else(invalid)? {
        Host::Ipv6(ip) => format!("[{ip}]"),
        host => host.to_string(),
    };
    let port = proxy.port_or_known_default().filter(|port| *port != 0).ok_or_else(invalid)?;
    Ok(format!("{host}:{port}"))
}
pub fn fetch(value: &str) -> Result<FeedResponse, StorageError> { fetch_with_proxy(value, None) }
pub fn fetch_with_proxy(value: &str, proxy: Option<&str>) -> Result<FeedResponse, StorageError> {
    fetch_for(value, proxy, false)
}
pub fn fetch_article_with_proxy(value: &str, proxy: Option<&str>) -> Result<FeedResponse, StorageError> {
    fetch_for(value, proxy, true).map_err(|error| {
        let reason=error.message.replace("订阅", "原文").replace("。未报告采集成功。", "。").replace("未报告采集成功；", "");
        StorageError::new(&error.code, &format!("原文获取失败，已保留订阅摘要和来源链接。{reason}"))
    })
}
fn fetch_for(value: &str, proxy: Option<&str>, article: bool) -> Result<FeedResponse, StorageError> {
    let url = public_url(value)?;
    let proxy = proxy.map(proxy_server).transpose()?;
    #[cfg(windows)]
    { windows_http::fetch(url, proxy.as_deref(), article, false) }
    #[cfg(not(windows))]
    { let _ = (url, proxy, article); Err(StorageError::new("feed_platform_unsupported", "资讯采集目前仅接入 Windows 桌面版，没有执行采集或保存。")) }
}

// Exchange rates use a fixed public service and the Windows system proxy. Feed URLs
// continue to use their explicit proxy policy and checked DNS addresses.
pub fn fetch_exchange(value: &str) -> Result<FeedResponse, StorageError> {
    let url = public_url(value)?;
    if url.scheme() != "https" || url.host_str() != Some("api.frankfurter.dev") {
        return Err(invalid());
    }
    #[cfg(windows)]
    { windows_http::fetch(url, None, false, true) }
    #[cfg(not(windows))]
    { let _ = url; Err(StorageError::new("exchange_platform", "汇率读取目前仅接入 Windows 桌面版。")) }
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
        fn new(value: *mut c_void, stage: &str) -> Result<Self, StorageError> {
            if value.is_null() { Err(network_error(windows::core::Error::from_thread(), stage)) } else { Ok(Self(value)) }
        }
    }
    impl Drop for Handle { fn drop(&mut self) { unsafe { let _ = WinHttpCloseHandle(self.0); } } }
    fn network_error(error: windows::core::Error, stage: &str) -> StorageError {
        let code = error.code().0 as u32 & 0xffff;
        let reason = match code {
            12002 => "请求超时，请核对网络与代理是否可用",
            12007 => "域名解析失败，请核对信源或代理主机地址及 DNS",
            12029 => "无法建立连接，请核对信源是否可达、代理软件是否运行及端口是否正确",
            12030 | 12031 => "连接中断，请稍后重试该信源",
            12175 | 12037 | 12038 | 12044 | 12045 | 12057 => "TLS 校验或握手失败，请核对系统时间、证书及代理转发；没有跳过证书验证",
            87 | 12005 | 12009 => "网络参数或系统支持不匹配，请核对地址与 Windows 版本",
            _ => "网络请求失败，请按错误码核对网络、代理或信源服务",
        };
        StorageError::new("feed_fetch_failed", &format!("{stage}失败（Windows {code}）：{reason}。未报告采集成功。"))
    }
    fn timeout() -> StorageError { StorageError::new("feed_timeout", "订阅请求超时，未报告采集成功；可稍后重试这个来源。") }
    fn wide(value: &str) -> Vec<u16> { value.encode_utf16().chain(Some(0)).collect() }
    fn option(handle: &Handle, key: u32, bytes: &[u8]) -> Result<(), StorageError> {
        unsafe { WinHttpSetOption(Some(handle.0.cast_const()), key, Some(bytes)) }.map_err(|e| network_error(e, "配置订阅网络选项"))
    }
    fn header(handle: &Handle, key: u32) -> Result<Option<String>, StorageError> {
        let mut size = 0;
        let first = unsafe { WinHttpQueryHeaders(handle.0, key, PCWSTR::null(), None, &mut size, std::ptr::null_mut()) };
        if let Err(error) = first.as_ref() {
            let code = error.code().0 as u32 & 0xffff;
            if code == 12150 { return Ok(None); } // Header not present.
            if code != 122 { return Err(network_error(error.clone(), "读取订阅响应头")); }
        }
        if first.is_ok() && size == 0 { return Ok(None); }
        if size == 0 { return Ok(None); }
        if size > 16 * 1024 { return Err(StorageError::new("feed_headers_large", "订阅响应头过大，已停止读取。")); }
        let mut buffer = vec![0u16; (size as usize + 1) / 2];
        unsafe { WinHttpQueryHeaders(handle.0, key, PCWSTR::null(), Some(buffer.as_mut_ptr().cast()), &mut size, std::ptr::null_mut()) }
            .map_err(|e| network_error(e, "读取订阅响应头"))?;
        let end = buffer.iter().position(|value| *value == 0).unwrap_or(buffer.len());
        String::from_utf16(&buffer[..end]).map(Some).map_err(|_| StorageError::new("feed_headers_invalid", "订阅响应头编码无效，已停止读取。"))
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
        }).map_err(|_| StorageError::new("feed_dns_failed", "无法启动订阅 DNS 解析，未请求信源。"))?;
        let addresses = receive.recv_timeout(remaining.min(Duration::from_secs(8))).map_err(|_| timeout())?
            .map_err(|e| StorageError::new("feed_dns_failed", &format!("订阅域名解析失败（系统错误 {}），请核对 DNS 或配置 HTTP 代理。", e.raw_os_error().unwrap_or(0))))?;
        if addresses.is_empty() { return Err(StorageError::new("feed_dns_failed", "订阅域名没有返回可用地址，请核对 DNS 或配置 HTTP 代理。")); }
        if addresses.iter().any(|ip| !public_ip(*ip)) { return Err(StorageError::new("feed_dns_non_public", "订阅域名解析到了非公网地址，直连已停止。如果代理软件使用 Fake-IP，请在采集与日报设置填写 HTTP / Mixed 代理地址；内网订阅仍不支持。")); }
        Ok(addresses.iter().copied().find(IpAddr::is_ipv4).unwrap_or(addresses[0]))
    }
    fn remaining(deadline: Instant) -> Result<Duration, StorageError> {
        deadline.checked_duration_since(Instant::now()).filter(|duration| !duration.is_zero()).ok_or_else(timeout)
    }
    fn set_timeout(handle: &Handle, deadline: Instant) -> Result<(), StorageError> {
        let milliseconds = remaining(deadline)?.as_millis().clamp(1, 10_000) as i32;
        unsafe { WinHttpSetTimeouts(handle.0, milliseconds, milliseconds, milliseconds, milliseconds) }.map_err(|e| network_error(e, "配置订阅超时"))
    }
    pub fn fetch(mut url: Url, proxy: Option<&str>, article: bool, exchange: bool) -> Result<FeedResponse, StorageError> {
        let deadline = Instant::now() + Duration::from_secs(45);
        let proxy_name = proxy.map(wide);
        let mode = if exchange { "汇率请求" } else { match (proxy.is_some(), article) {(true,true)=>"代理原文",(false,true)=>"直连原文",(true,false)=>"代理订阅",(false,false)=>"直连订阅"} };
        for redirects in 0..=5 {
            // The explicitly trusted proxy resolves targets; local Fake-IP DNS must not be pinned into its requests.
            // Every target/redirect still passes public_url. Proxy DNS/IP routing is controlled by the user's proxy.
            let ip = if proxy.is_none() && !exchange { Some(resolve(&url, remaining(deadline)?)?) } else { None };
            remaining(deadline)?;
            let access = if exchange { WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY } else if proxy.is_some() { WINHTTP_ACCESS_TYPE_NAMED_PROXY } else { WINHTTP_ACCESS_TYPE_NO_PROXY };
            let proxy_pointer = proxy_name.as_ref().map_or(PCWSTR::null(), |name| PCWSTR(name.as_ptr()));
            let session = Handle::new(unsafe { WinHttpOpen(w!("AZCine/0.0 RSS reader"), access, proxy_pointer, PCWSTR::null(), 0) }, "创建订阅网络会话")?;
            option(&session, WINHTTP_OPTION_DISABLE_GLOBAL_POOLING, &1u32.to_ne_bytes())?;
            set_timeout(&session, deadline)?;
            let host = wide(url.host_str().ok_or_else(invalid)?.trim_matches(['[', ']']));
            let connection = Handle::new(unsafe { WinHttpConnect(session.0, PCWSTR(host.as_ptr()), url.port_or_known_default().ok_or_else(invalid)?, 0) }, mode)?;
            let path = wide(&format!("{}{}", url.path(), url.query().map(|query| format!("?{query}")).unwrap_or_default()));
            let flags = if url.scheme() == "https" { WINHTTP_FLAG_SECURE } else { WINHTTP_OPEN_REQUEST_FLAGS(0) };
            let request = Handle::new(unsafe { WinHttpOpenRequest(connection.0, w!("GET"), PCWSTR(path.as_ptr()), PCWSTR::null(), PCWSTR::null(), std::ptr::null(), flags) }, "创建订阅请求")?;
            option(&request, WINHTTP_OPTION_DISABLE_FEATURE, &(WINHTTP_DISABLE_REDIRECTS | WINHTTP_DISABLE_COOKIES | WINHTTP_DISABLE_AUTHENTICATION).to_ne_bytes())?;
            // Pin DNS to the already checked address while keeping the original hostname for TLS/SNI/Host.
            // Windows 10 21H1+; unsupported OS/options fail closed instead of requesting an unchecked address.
            if let Some(ip) = ip {
                let pinned = wide(&ip.to_string());
                let bytes = unsafe { std::slice::from_raw_parts(pinned.as_ptr().cast::<u8>(), pinned.len() * 2) };
                option(&request, WINHTTP_OPTION_RESOLUTION_HOSTNAME, bytes)?;
            }
            option(&request, WINHTTP_OPTION_DECOMPRESSION, &(WINHTTP_DECOMPRESSION_FLAG_GZIP | WINHTTP_DECOMPRESSION_FLAG_DEFLATE).to_ne_bytes())?;
            set_timeout(&request, deadline)?;
            let accept = if exchange { "Accept: application/json\r\n" } else if article { "Accept: text/html, application/xhtml+xml;q=0.9, */*;q=0.5\r\n" } else { "Accept: application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9\r\n" };
            let headers: Vec<u16> = accept.encode_utf16().collect();
            unsafe { WinHttpSendRequest(request.0, Some(&headers), None, 0, 0, 0) }.map_err(|e| network_error(e, &format!("{mode}发送请求")))?;
            set_timeout(&request, deadline)?;
            unsafe { WinHttpReceiveResponse(request.0, std::ptr::null_mut()) }.map_err(|e| network_error(e, &format!("{mode}接收响应")))?;
            let status = header(&request, WINHTTP_QUERY_STATUS_CODE)?.and_then(|value| value.parse::<u16>().ok()).ok_or_else(|| StorageError::new("feed_headers_invalid", "订阅没有返回有效 HTTP 状态码，未报告成功。"))?;
            if matches!(status, 301 | 302 | 303 | 307 | 308) {
                if redirects == 5 { return Err(StorageError::new("feed_redirect_limit", "订阅重定向超过5次，已停止请求。")); }
                let location = header(&request, WINHTTP_QUERY_LOCATION)?.ok_or_else(|| StorageError::new("feed_redirect_invalid", "订阅重定向没有返回目标地址，已停止请求。"))?;
                let next = url.join(&location).map_err(|_| invalid())?;
                public_url(next.as_str())?;
                if exchange && (next.scheme() != "https" || next.host_str() != Some("api.frankfurter.dev")) {
                    return Err(StorageError::new("exchange_redirect", "汇率服务重定向到了其他地址，已停止请求。"));
                }
                if url.scheme() == "https" && next.scheme() != "https" { return Err(StorageError::new("feed_insecure_redirect", "HTTPS订阅转向不安全的HTTP地址，已停止请求。")); }
                url = next; continue;
            }
            if status == 407 { return Err(StorageError::new("feed_proxy_auth", "代理要求身份认证（HTTP 407）；目前支持无需登录的 HTTP / Mixed 代理端口，请核对代理设置。")); }
            if !(200..300).contains(&status) {
                // Identify the browser challenge seen on public article links.
                // Read only a small diagnostic prefix, never execute its scripts
                // or treat a challenge page as an article body.
                if article && matches!(status, 401 | 403) {
                    let mut prefix = [0u8; 8192];
                    let mut count = 0;
                    if set_timeout(&request, deadline).is_ok()
                        && unsafe { WinHttpReadData(request.0, prefix.as_mut_ptr().cast(), prefix.len() as u32, &mut count) }.is_ok() {
                        let page = String::from_utf8_lossy(&prefix[..count as usize]);
                        if page.contains("captcha-delivery.com") && page.contains("enable JS") {
                            return Err(StorageError::new("news_browser_required", &format!("原报道返回浏览器验证页（HTTP {status}），需要在浏览器中完成页面加载或验证；当前仅取得订阅摘要，未取得原文。")));
                        }
                    }
                }
                return Err(StorageError::new("feed_http_status", &format!("信源返回 HTTP {status}，未当作正常无新增；不自动登录或绕过访问限制。")));
            }
            if header(&request, WINHTTP_QUERY_CONTENT_LENGTH)?.and_then(|value| value.parse::<usize>().ok()).is_some_and(|length| length > MAX_FEED_BYTES) {
                return Err(StorageError::new("feed_too_large", "订阅响应超过4 MiB，已停止读取，原资料保持不变。"));
            }
            let mut body = Vec::new();
            let mut buffer = [0u8; 16 * 1024];
            loop {
                set_timeout(&request, deadline)?;
                let mut count = 0;
                unsafe { WinHttpReadData(request.0, buffer.as_mut_ptr().cast(), buffer.len() as u32, &mut count) }.map_err(|e| network_error(e, &format!("{mode}读取内容")))?;
                if count == 0 { break; }
                if body.len() + count as usize > MAX_FEED_BYTES { return Err(StorageError::new("feed_too_large", "解压后的订阅超过4 MiB，已停止读取，原资料保持不变。")); }
                body.extend_from_slice(&buffer[..count as usize]);
            }
            return Ok(FeedResponse { body, url: url.into(), fetched_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true) });
        }
        Err(StorageError::new("feed_redirect_limit", "订阅重定向超过5次，已停止请求。"))
    }
}
