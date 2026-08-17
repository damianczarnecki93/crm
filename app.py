import sys
import os
import secrets
import click
import threading
import webview
from flask import Flask
from flask_wtf.csrf import CSRFProtect

# Pobieranie poprawnej ścieżki do plików tymczasowych po spakowaniu do .exe
if getattr(sys, 'frozen', False):
    PROJECT_ROOT = sys._MEIPASS
    DATABASE_PATH = os.path.join(os.path.dirname(sys.executable), 'crm.db')
else:
    PROJECT_ROOT = os.path.abspath(os.path.dirname(__file__))
    DATABASE_PATH = os.path.join(PROJECT_ROOT, 'crm.db')

user_data_dir = os.path.join(os.path.dirname(DATABASE_PATH), '.user_data')
os.makedirs(user_data_dir, exist_ok=True)

def load_or_generate_secret_key(user_data_directory):
    key_file = os.path.join(user_data_directory, 'secret_key.bin')
    if os.path.exists(key_file):
        try:
            with open(key_file, 'rb') as f:
                key = f.read()
                if len(key) >= 24:
                    return key
        except Exception:
            pass
    
    new_key = secrets.token_bytes(32)
    try:
        with open(key_file, 'wb') as f:
            f.write(new_key)
    except Exception:
        pass
    return new_key

def create_app():
    app = Flask(
        __name__,
        template_folder=os.path.join(PROJECT_ROOT, 'templates'),
        static_folder=os.path.join(PROJECT_ROOT, 'static')
    )
    
    app.config['PROJECT_ROOT'] = PROJECT_ROOT
    app.config['DATABASE_PATH'] = DATABASE_PATH
    app.secret_key = load_or_generate_secret_key(user_data_dir)
    
    CSRFProtect(app)

    from routes.main import main_bp
    from routes.contacts import contacts_bp
    from routes.history import history_bp
    from routes.api import api_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(contacts_bp)
    app.register_blueprint(history_bp)
    app.register_blueprint(api_bp)

    @app.cli.command('init-db')
    def init_db_command():
        """Tworzy nową, czystą bazę danych."""
        from db import init_db
        click.echo('--- URUCHAMIAM POPRAWNĄ FUNKCJĘ TWORZENIA BAZY ---')
        init_db()
        click.echo('Zainicjowano bazę danych z poprawną strukturą.')

    return app

app = create_app()

def run_flask():
    from db import init_db
    if not os.path.exists(DATABASE_PATH):
        with app.app_context():
            init_db()
    app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False)

if __name__ == '__main__':
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()

    webview.create_window(
        title='CRM - Aplikacja Desktopowa',
        url='http://127.0.0.1:5000',
        width=1280,
        height=800,
        resizable=True
    )

    webview.start(private_mode=False, storage_path=user_data_dir)