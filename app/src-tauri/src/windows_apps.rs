// Windows foreground process + window enumeration helpers.
//
// These are used for per-program prompt profiles.

#[cfg(target_os = "windows")]
mod imp {
    use windows::core::{BOOL, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, IsWindowVisible,
    };

    #[derive(Debug, Clone, serde::Serialize)]
    pub struct OpenWindowInfo {
        pub title: String,
        pub process_path: String,
    }

    fn query_process_path(pid: u32) -> Option<String> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;

            // Large buffer to avoid truncation.
            let mut buf: Vec<u16> = vec![0; 4096];
            let mut size: u32 = buf.len() as u32;

            let ok = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                PWSTR(buf.as_mut_ptr()),
                &mut size,
            )
            .is_ok();

            let _ = CloseHandle(handle);

            if !ok || size == 0 {
                return None;
            }

            Some(String::from_utf16_lossy(&buf[..size as usize]))
        }
    }

    pub fn get_foreground_process_path() -> Option<String> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return None;
            }

            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == 0 {
                return None;
            }

            query_process_path(pid)
        }
    }

    pub fn list_open_windows() -> Vec<OpenWindowInfo> {
        unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
            // Safety: caller passes a valid mutable Vec pointer via LPARAM.
            let windows = unsafe { &mut *(lparam.0 as *mut Vec<OpenWindowInfo>) };

            unsafe {
                if !IsWindowVisible(hwnd).as_bool() {
                    return BOOL(1);
                }

                let title_len = GetWindowTextLengthW(hwnd);
                if title_len == 0 {
                    return BOOL(1);
                }

                let mut title_buf: Vec<u16> = vec![0; (title_len as usize) + 1];
                let copied = GetWindowTextW(hwnd, &mut title_buf);
                if copied == 0 {
                    return BOOL(1);
                }

                let title = String::from_utf16_lossy(&title_buf[..copied as usize]).trim().to_string();
                if title.is_empty() {
                    return BOOL(1);
                }

                let mut pid: u32 = 0;
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
                if pid == 0 {
                    return BOOL(1);
                }

                let Some(process_path) = query_process_path(pid) else {
                    return BOOL(1);
                };

                windows.push(OpenWindowInfo { title, process_path });
                BOOL(1)
            }
        }

        let mut windows: Vec<OpenWindowInfo> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(enum_proc), LPARAM((&mut windows as *mut _) as isize));
        }

        windows
    }
}

#[cfg(target_os = "windows")]
pub use imp::{get_foreground_process_path, list_open_windows, OpenWindowInfo};

#[cfg(not(target_os = "windows"))]
mod imp_stub {
    #[derive(Debug, Clone, serde::Serialize)]
    pub struct OpenWindowInfo {
        pub title: String,
        pub process_path: String,
    }

    pub fn get_foreground_process_path() -> Option<String> {
        None
    }

    pub fn list_open_windows() -> Vec<OpenWindowInfo> {
        Vec::new()
    }
}

#[cfg(not(target_os = "windows"))]
pub use imp_stub::{get_foreground_process_path, list_open_windows, OpenWindowInfo};
