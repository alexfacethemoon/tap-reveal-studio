import webview
import sys
import os
import base64

def get_resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_path, relative_path)


class Api:
    """Bridge between JS and native OS dialogs for .tsp file operations."""
    
    def __init__(self, window):
        self._window = window

    def save_file_dialog(self, default_name, base64_data):
        """Open a native 'Save As' dialog and write the file (PNG export or .tsp project)."""
        ext = os.path.splitext(default_name)[1].lower()
        if ext == '.png':
            file_types = ('PNG Image (*.png)', 'All files (*.*)')
        elif ext == '.tsp':
            file_types = ('TapStudio Project (*.tsp)', 'All files (*.*)')
        else:
            file_types = ('All files (*.*)',)
        result = self._window.create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename=default_name,
            file_types=file_types
        )
        if result:
            path = result if isinstance(result, str) else result[0]
            if path:
                data = base64.b64decode(base64_data)
                with open(path, 'wb') as f:
                    f.write(data)
                return True
        return False

    def open_file_dialog(self):
        """Open a native 'Open' dialog and return the file contents as base64."""
        result = self._window.create_file_dialog(
            webview.OPEN_DIALOG,
            file_types=('TapStudio Project (*.tsp)',)
        )
        if result:
            path = result if isinstance(result, str) else result[0]
            if path and os.path.isfile(path):
                with open(path, 'rb') as f:
                    data = f.read()
                return base64.b64encode(data).decode('utf-8')
        return None


import winreg
import subprocess
import tempfile

def register_tsp_extension():
    """Silently registers the .tsp extension so the OS shows thumbnails and associates the app."""
    exe_path = sys.executable if getattr(sys, 'frozen', False) else os.path.abspath(__file__)
    icon_path = get_resource_path('icon.ico')

    if sys.platform == 'win32':
        try:
            def set_reg(key_path, value_name, value):
                with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path) as key:
                    winreg.SetValueEx(key, value_name, 0, winreg.REG_SZ, value)
            
            # 1. File extension
            set_reg(r"Software\Classes\.tsp", "", "TapStudioProject")
            set_reg(r"Software\Classes\.tsp", "Content Type", "image/png")
            set_reg(r"Software\Classes\.tsp", "PerceivedType", "image")
            set_reg(r"Software\Classes\.tsp\OpenWithProgids", "pngfile", "")
            set_reg(r"Software\Classes\.tsp\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}", "", "{C7657C4A-9F68-40fa-A4DF-96BC08EB3551}")
            
            # 2. ProgID
            set_reg(r"Software\Classes\TapStudioProject", "", "TapStudio Pro Project")
            set_reg(r"Software\Classes\TapStudioProject\DefaultIcon", "", f'"{icon_path}"')
            set_reg(r"Software\Classes\TapStudioProject\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}", "", "{C7657C4A-9F68-40fa-A4DF-96BC08EB3551}")
            
            # 3. Open with command
            if getattr(sys, 'frozen', False) and exe_path.endswith('.exe'):
                set_reg(r"Software\Classes\TapStudioProject\shell\open\command", "", f'"{exe_path}" "%1"')
        except Exception as e:
            print(f"Warning: Could not register Windows .tsp extension: {e}")

    elif sys.platform.startswith('linux'):
        # On Linux, file managers (Nautilus/Dolphin) sniff the PNG header automatically for thumbnails.
        # We just need to associate the .tsp extension with the app.
        if getattr(sys, 'frozen', False):
            try:
                mime_xml = """<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-tapstudio-project">
    <comment>TapStudio Pro Project</comment>
    <glob pattern="*.tsp"/>
    <sub-class-of type="image/png"/>
  </mime-type>
</mime-info>"""
                desktop_file = f"""[Desktop Entry]
Name=TapStudio Pro
Exec="{exe_path}" %f
Icon={icon_path}
Terminal=false
Type=Application
MimeType=application/x-tapstudio-project;
"""
                # Write and install MIME
                with tempfile.NamedTemporaryFile(mode='w', suffix='.xml', delete=False) as f:
                    f.write(mime_xml)
                    mime_tmp = f.name
                subprocess.run(['xdg-mime', 'install', '--user', mime_tmp], check=False)
                os.remove(mime_tmp)
                
                # Write and install Desktop entry
                with tempfile.NamedTemporaryFile(mode='w', suffix='.desktop', delete=False) as f:
                    f.write(desktop_file)
                    desk_tmp = f.name
                subprocess.run(['xdg-desktop-menu', 'install', '--user', desk_tmp], check=False)
                subprocess.run(['xdg-mime', 'default', os.path.basename(desk_tmp), 'application/x-tapstudio-project'], check=False)
                os.remove(desk_tmp)
            except Exception as e:
                print(f"Warning: Could not register Linux .tsp extension: {e}")
                
    elif sys.platform == 'darwin':
        # macOS Finder automatically shows the thumbnail because it sniffs the valid PNG header.
        # File association on macOS is handled by the Info.plist when building the .app bundle.
        # Python at runtime cannot easily register extensions on macOS.
        pass

def main():
    # Register the file extension silently on startup
    register_tsp_extension()
    
    # Path to the main HTML file
    index_path = get_resource_path('index.html')
    
    # Ensure the file exists
    if not os.path.exists(index_path):
        print(f"Error: Could not find {index_path}")
        sys.exit(1)
    
    # Create the API instance (window reference set after creation)
    api = Api(None)
    
    # Create and start the webview window
    window = webview.create_window(
        title='TapStudio Pro', 
        url=index_path, 
        width=1280, 
        height=800,
        min_size=(800, 600),
        text_select=False,
        js_api=api
    )
    
    # Update the API's window reference
    api._window = window
    
    webview.start()

if __name__ == '__main__':
    main()
