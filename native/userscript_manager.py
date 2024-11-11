#!/usr/bin/env python3
import json
import sys
import os
import time
import struct
import logging
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# Set up logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(os.path.expanduser('~/.local/share/userscript-manager.log')),
        logging.StreamHandler(sys.stderr)  # Log to stderr instead of stdout
    ]
)

class ScriptManager:
    def __init__(self):
        self.scripts_dir = Path.home() / 'Public' / 'Scripts'
        self.scripts_dir.mkdir(parents=True, exist_ok=True)
        self.cached_scripts = {}
        self.last_update = 0

    def read_script(self, path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
                
            # Parse metadata if present
            metadata = {}
            if content.startswith('// ==UserScript=='):
                meta_end = content.find('// ==/UserScript==')
                if meta_end != -1:
                    meta_section = content[:meta_end]
                    for line in meta_section.split('\n'):
                        if line.startswith('// @'):
                            try:
                                key, value = line[4:].split(' ', 1)
                                key = key.strip()
                                value = value.strip()
                                
                                # Handle multiple values for match/exclude
                                if key in ['match', 'exclude']:
                                    if key not in metadata:
                                        metadata[key] = []
                                    metadata[key].append(value)
                                else:
                                    metadata[key] = value
                            except ValueError:
                                pass
            
            return {
                'name': path.name,
                'path': str(path),
                'content': content,
                'metadata': metadata,
                'enabled': True,
                'mtime': path.stat().st_mtime
            }
        except Exception as e:
            logging.error(f"Error reading script {path}: {e}")
            return None

    def get_all_scripts(self):
        scripts = []
        for path in self.scripts_dir.glob('*.js'):
            script = self.read_script(path)
            if script:
                scripts.append(script)
                logging.debug(f"Loaded script: {script['name']}")
        return scripts

    def send_message(self, message):
        """Send a message using native messaging protocol"""
        try:
            encoded = json.dumps(message).encode('utf-8')
            sys.stdout.buffer.write(struct.pack('=I', len(encoded)))
            sys.stdout.buffer.write(encoded)
            sys.stdout.buffer.flush()
            logging.debug(f"Sent message: {message['type']}")
        except Exception as e:
            logging.error(f"Error sending message: {e}")

def read_native_message():
    """Read a message using native messaging protocol"""
    try:
        raw_length = sys.stdin.buffer.read(4)
        if not raw_length:
            return None
        message_length = struct.unpack('=I', raw_length)[0]
        message_raw = sys.stdin.buffer.read(message_length)
        return json.loads(message_raw.decode('utf-8'))
    except Exception as e:
        logging.error(f"Error reading message: {e}")
        return None

class ScriptEventHandler(FileSystemEventHandler):
    def __init__(self, manager):
        self.manager = manager
        
    def on_any_event(self, event):
        if event.is_directory or not event.src_path.endswith('.js'):
            return
            
        # Debounce updates
        current_time = time.time()
        if current_time - self.manager.last_update < 0.1:
            return
        self.manager.last_update = current_time
        
        # Send updated scripts
        scripts = self.manager.get_all_scripts()
        self.manager.send_message({
            'type': 'SCRIPTS_UPDATE',
            'scripts': scripts
        })
        logging.info(f"Sent update for {len(scripts)} scripts")

def main():
    try:
        manager = ScriptManager()
        logging.info("Script Manager initialized")
        
        # Initial load
        scripts = manager.get_all_scripts()
        manager.send_message({
            'type': 'SCRIPTS_UPDATE',
            'scripts': scripts
        })
        logging.info(f"Initial load: {len(scripts)} scripts")
        
        # Set up file watching
        event_handler = ScriptEventHandler(manager)
        observer = Observer()
        observer.schedule(event_handler, str(manager.scripts_dir), recursive=False)
        observer.start()
        logging.info(f"Watching directory: {manager.scripts_dir}")
        
        # Main message loop
        while True:
            message = read_native_message()
            if message is None:
                break
                
            if message.get('type') == 'TEST_CONNECTION':
                manager.send_message({'type': 'CONNECTION_OK'})
            elif message.get('type') == 'GET_SCRIPTS':
                manager.send_message({
                    'type': 'SCRIPTS_UPDATE',
                    'scripts': manager.get_all_scripts()
                })
                
    except KeyboardInterrupt:
        logging.info("Shutting down...")
        observer.stop()
        observer.join()
    except Exception as e:
        logging.error(f"Fatal error: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
