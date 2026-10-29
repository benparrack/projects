"""Maximizes or un-maximizes the dashboard window (X11), since a page can't resize a maximized window.
Usage: tile.py max|unmax. No xdotool/wmctrl here, so it talks to libX11 directly."""
import ctypes, os, re, subprocess, sys

X = ctypes.cdll.LoadLibrary('libX11.so.6')
X.XOpenDisplay.restype = ctypes.c_void_p
X.XDefaultRootWindow.restype = ctypes.c_ulong
X.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
X.XInternAtom.restype = ctypes.c_ulong
X.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]


class ClientMessage(ctypes.Structure):
    _fields_ = [('type', ctypes.c_int), ('serial', ctypes.c_ulong), ('send_event', ctypes.c_int), ('display', ctypes.c_void_p),
                ('window', ctypes.c_ulong), ('message_type', ctypes.c_ulong), ('format', ctypes.c_int), ('data', ctypes.c_long * 5),
                ('pad', ctypes.c_long * 12)]   # XEvent is 24 longs


def windows():
    """Top-level dashboard windows: title ends in 'Internship Bot' (the form popup has the job's title)."""
    tree = subprocess.run(['xwininfo', '-root', '-tree'], capture_output=True, text=True).stdout
    return [int(m.group(1), 16) for m in re.finditer(r'^\s*(0x[0-9a-f]+) "(?:\(\d+\) )?Internship Bot": \("127\.0\.0\.1" "' + os.environ.get('TILE_CLASS', 'InternshipBot') + r'"\)', tree, re.M)]


def main(mode):
    d = X.XOpenDisplay(None)
    root = X.XDefaultRootWindow(d)
    state = X.XInternAtom(d, b'_NET_WM_STATE', 0)
    h, v = X.XInternAtom(d, b'_NET_WM_STATE_MAXIMIZED_HORZ', 0), X.XInternAtom(d, b'_NET_WM_STATE_MAXIMIZED_VERT', 0)
    for w in windows():
        ev = ClientMessage(type=33, send_event=1, window=w, message_type=state, format=32)   # 33 = ClientMessage
        ev.data[:] = [1 if mode == 'max' else 0, h, v, 1, 0]                                   # 1 add / 0 remove
        X.XSendEvent.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_long, ctypes.c_void_p]
        X.XSendEvent(d, root, 0, (1 << 20) | (1 << 19), ctypes.byref(ev))                    # SubstructureRedirect|Notify
    X.XFlush(d)
    print(len(windows()), 'window(s)')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'unmax')
