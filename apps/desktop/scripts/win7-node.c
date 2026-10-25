/* Run the bundled patched Electron as Node without changing the caller's environment. */
#define _WIN32_WINNT 0x0601
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <wchar.h>
#include <stdio.h>

int wmain(void) {
    WCHAR executable[32768];
    WCHAR command[32768];
    DWORD length = GetModuleFileNameW(NULL, executable, 32768);
    if (!length || length >= 32768) return 126;
    WCHAR *separator = wcsrchr(executable, L'\\');
    if (!separator) return 126;
    if (wcscpy_s(separator + 1, 32768 - (size_t)(separator + 1 - executable), L"electron.exe")) return 126;
    const WCHAR *arguments = GetCommandLineW();
    if (*arguments == L'"') {
        arguments++;
        while (*arguments && *arguments != L'"') arguments++;
        if (*arguments) arguments++;
    } else {
        while (*arguments && *arguments != L' ' && *arguments != L'\t') arguments++;
    }
    if (_snwprintf_s(command, 32768, _TRUNCATE, L"\"%s\"%s", executable, arguments) < 0) return 126;
    if (!SetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE", L"1")) return 126;
    STARTUPINFOW startup = {0};
    PROCESS_INFORMATION child = {0};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
    startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    if (!CreateProcessW(executable, command, NULL, NULL, TRUE, 0, NULL, NULL, &startup, &child)) {
        fwprintf(stderr, L"Win7 Node launcher: CreateProcessW failed (%lu)\n", GetLastError());
        return 126;
    }
    CloseHandle(child.hThread);
    DWORD result = 126;
    if (WaitForSingleObject(child.hProcess, INFINITE) == WAIT_OBJECT_0) GetExitCodeProcess(child.hProcess, &result);
    CloseHandle(child.hProcess);
    return (int)result;
}
