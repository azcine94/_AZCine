//! Keep native clipboard/edit commands, remove browser navigation and developer actions.
// https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/context-menus
#[cfg(windows)]
pub fn install(window:&tauri::WebviewWindow)->tauri::Result<()> {
    use windows::core::{Interface,PWSTR};
    use webview2_com::{CoTaskMemPWSTR,ContextMenuRequestedEventHandler,Microsoft::Web::WebView2::Win32::ICoreWebView2_11};
    window.with_webview(|webview|{
        let setup=(||->windows::core::Result<()> { unsafe {
            let core:ICoreWebView2_11=webview.controller().CoreWebView2()?.cast()?;
            let handler=ContextMenuRequestedEventHandler::create(Box::new(|_,args|{
                let Some(args)=args else{return Ok(());};
                let filtered=(||->windows::core::Result<()> {
                    let items=args.MenuItems()?;let mut count=0;items.Count(&mut count)?;
                    for index in (0..count).rev(){
                        let item=items.GetValueAtIndex(index)?;let mut name=PWSTR::null();item.Name(&mut name)?;
                        let name=CoTaskMemPWSTR::from(name).to_string();
                        if !matches!(name.as_str(),"undo"|"redo"|"cut"|"copy"|"paste"|"pasteAndMatchStyle"|"delete"|"selectAll"|"copyImage"|"copyImageLink"|"copyLink"|"copyLinkAddress"){items.RemoveValueAtIndex(index)?;}
                    }
                    items.Count(&mut count)?;if count==0{args.SetHandled(true)?;}Ok(())
                })();
                if filtered.is_err(){args.SetHandled(true)?;}
                Ok(())
            }));
            let mut token=0;core.add_ContextMenuRequested(&handler,&mut token)?;Ok(())
        }})();
        if setup.is_err(){eprintln!("AZCine: native context menu setup failed");}
    })
}
#[cfg(not(windows))]
pub fn install(_window:&tauri::WebviewWindow)->tauri::Result<()>{Ok(())}
