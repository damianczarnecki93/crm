import os
import sqlite3
import re
from datetime import datetime, timezone
from flask import current_app

def get_db_conn():
    db_path = current_app.config['DATABASE_PATH']
    conn = sqlite3.connect(db_path, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA busy_timeout = 30000;")
    try:
        conn.execute("PRAGMA journal_mode = WAL;")
    except Exception:
        pass
    return conn

import urllib.request
import urllib.parse
import json
import time

POLISH_CITY_COORDS = {
    'warszawa': (52.2297, 21.0122), 'kraków': (50.0647, 19.9450), 'krakow': (50.0647, 19.9450),
    'wrocław': (51.1100, 17.0333), 'wroclaw': (51.1100, 17.0333), 'poznań': (52.4064, 16.9252),
    'poznan': (52.4064, 16.9252), 'gdańsk': (54.3520, 18.6466), 'gdansk': (54.3520, 18.6466),
    'szczecin': (53.4285, 14.5528), 'bydgoszcz': (53.1235, 18.0084), 'lublin': (51.2465, 22.5684),
    'katowice': (50.2649, 19.0238), 'białystok': (53.1325, 23.1688), 'bialystok': (53.1325, 23.1688),
    'gdynia': (54.5189, 18.5305), 'częstochowa': (50.8118, 19.1203), 'czestochowa': (50.8118, 19.1203),
    'radom': (51.4027, 21.1471), 'sosnowiec': (50.2863, 19.1041), 'toruń': (53.0138, 18.5981),
    'torun': (53.0138, 18.5981), 'kielce': (50.8703, 20.6275), 'rzeszów': (50.0412, 21.9991),
    'rzeszow': (50.0412, 21.9991), 'gliwice': (50.2945, 18.6714), 'olsztyn': (53.7784, 20.4801),
    'bielsko-biała': (49.8225, 19.0444), 'zielona góra': (51.9356, 15.5062), 'opole': (50.6721, 17.9253)
}

def clean_street_name(street_str):
    """Usuwa skróty typu 'ul.', 'al.', 'pl.' oraz numery mieszkań (np. /12, m. 12) dla dokładniejszego geokodowania."""
    if not street_str:
        return ''
    cleaned = re.sub(r'^(ul\.|ulica|al\.|aleja|pl\.|plac)\s+', '', street_str.strip(), flags=re.IGNORECASE)
    # Usuwanie numeru mieszkania/lokalu (np. "Jasna 5/12" -> "Jasna 5", "Jasna 5 m. 12" -> "Jasna 5")
    cleaned = re.sub(r'/\d+\w*$', '', cleaned)
    cleaned = re.sub(r'\s+m\.\s*\d+.*$', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s+lok\.\s*\d+.*$', '', cleaned, flags=re.IGNORECASE)
    return cleaned.strip()

def geocode_address(street='', city='', voivodeship=''):
    """Zamienia adres/miasto na współrzędne (lat, lng) używając strukturalnego Nominatim API z polskim słownikiem rezerwowym."""
    city_clean = (city or '').strip()
    street_raw = (street or '').strip()
    street_clean = clean_street_name(street_raw)

    if not city_clean and not street_clean and not street_raw:
        return None, None

    # 1. Próba zapytania strukturalnego (street, city, country)
    if street_clean or street_raw:
        try:
            params = {
                'format': 'json',
                'street': street_clean or street_raw,
                'country': 'Polska',
                'limit': 1
            }
            if city_clean:
                params['city'] = city_clean

            url = f"https://nominatim.openstreetmap.org/search?{urllib.parse.urlencode(params)}"
            req = urllib.request.Request(url, headers={'User-Agent': 'CRM-Python-Application/1.0'})
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                if data and len(data) > 0:
                    return float(data[0]['lat']), float(data[0]['lon'])
        except Exception:
            pass

    # 2. Próba zapytania tekstowego z wyczyszczoną ulicą
    queries = []
    if street_clean and city_clean:
        queries.append(f"{street_clean}, {city_clean}, Polska")
    if street_raw and city_clean and street_raw != street_clean:
        queries.append(f"{street_raw}, {city_clean}, Polska")
    if street_clean:
        queries.append(f"{street_clean}, Polska")
    if city_clean:
        queries.append(f"{city_clean}, Polska")

    for q in queries:
        try:
            url = f"https://nominatim.openstreetmap.org/search?format=json&q={urllib.parse.quote(q)}&limit=1"
            req = urllib.request.Request(url, headers={'User-Agent': 'CRM-Python-Application/1.0'})
            with urllib.request.urlopen(req, timeout=2) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                if data and len(data) > 0:
                    return float(data[0]['lat']), float(data[0]['lon'])
        except Exception:
            pass

    # 3. Próba rezerwowa: słownik miast
    if city_clean:
        city_lower = city_clean.lower()
        if city_lower in POLISH_CITY_COORDS:
            return POLISH_CITY_COORDS[city_lower]
        for k, v in POLISH_CITY_COORDS.items():
            if k in city_lower or city_lower in k:
                return v

    return None, None

def migrate_db():
    """Migruje istniejącą bazę danych dodając brakujące kolumny i tabele."""
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(contacts);")
        columns = [col['name'] for col in cursor.fetchall()]
        if 'lost_reason' not in columns:
            cursor.execute("ALTER TABLE contacts ADD COLUMN lost_reason TEXT;")
        if 'latitude' not in columns:
            cursor.execute("ALTER TABLE contacts ADD COLUMN latitude REAL;")
        if 'longitude' not in columns:
            cursor.execute("ALTER TABLE contacts ADD COLUMN longitude REAL;")

        # Tworzenie tabeli sales_history
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS sales_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contact_id INTEGER NOT NULL,
                product_name TEXT NOT NULL,
                amount REAL NOT NULL,
                sale_date DATE NOT NULL,
                notes TEXT,
                FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE
            )''')

        # Tworzenie tabeli delegacji
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS delegations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                date DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )''')

        # Tworzenie tabeli punktów delegacji (stops)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS delegation_stops (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                delegation_id INTEGER NOT NULL,
                stop_order INTEGER NOT NULL,
                stop_type TEXT NOT NULL DEFAULT 'custom', -- 'start', 'end', 'hotel', 'contact', 'custom'
                name TEXT NOT NULL,
                address TEXT,
                latitude REAL,
                longitude REAL,
                visit_duration_minutes INTEGER DEFAULT 0,
                contact_id INTEGER,
                FOREIGN KEY (delegation_id) REFERENCES delegations (id) ON DELETE CASCADE,
                FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE SET NULL
            )''')
        conn.commit()

def init_db():
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('DROP TABLE IF EXISTS sales_history;')
        cursor.execute('DROP TABLE IF EXISTS contact_history;')
        cursor.execute('DROP TABLE IF EXISTS contacts;')
        
        cursor.execute('''
            CREATE TABLE contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                street TEXT,
                city TEXT,
                voivodeship TEXT,
                phone TEXT,
                email TEXT,
                nip TEXT,
                www TEXT,
                notes TEXT,
                reminder_date DATE,
                last_contact_date DATE,
                status TEXT NOT NULL DEFAULT 'nowy',
                lost_reason TEXT,
                latitude REAL,
                longitude REAL
            )''')
        
        cursor.execute('''
            CREATE TABLE contact_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contact_id INTEGER NOT NULL,
                change_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                change_description TEXT NOT NULL,
                FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE
            )''')

        cursor.execute('''
            CREATE TABLE sales_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contact_id INTEGER NOT NULL,
                product_name TEXT NOT NULL,
                amount REAL NOT NULL,
                sale_date DATE NOT NULL,
                notes TEXT,
                FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE
            )''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS delegations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                date DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS delegation_stops (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                delegation_id INTEGER NOT NULL,
                stop_order INTEGER NOT NULL,
                stop_type TEXT NOT NULL DEFAULT 'custom',
                name TEXT NOT NULL,
                address TEXT,
                latitude REAL,
                longitude REAL,
                visit_duration_minutes INTEGER DEFAULT 0,
                contact_id INTEGER,
                FOREIGN KEY (delegation_id) REFERENCES delegations (id) ON DELETE CASCADE,
                FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE SET NULL
            )''')
        conn.commit()

def calculate_lead_score(contact_row, history_count=0):
    """Oblicza punktację leada (Lead Score 0-100) na podstawie kompletności i aktywności."""
    score = 0
    # Kompletność danych (max 40)
    if contact_row.get('phone'): score += 10
    if contact_row.get('email'): score += 10
    if contact_row.get('nip'): score += 10
    if contact_row.get('street') or contact_row.get('city'): score += 10

    # Aktywność w historii (max 30)
    score += min(history_count * 10, 30)

    # Aktywne przypomnienie (max 15)
    if contact_row.get('reminder_date'): score += 15

    # Status klienta (max 15)
    status = contact_row.get('status')
    if status == 'lojalny': score += 15
    elif status == 'aktywny': score += 10
    elif status == 'kontakt': score += 5

    return min(score, 100)

def get_filtered_contacts_from_db(search_query, filter_city, filter_status, sort_by='name', sort_order='asc', limit=None, offset=None):
    today_iso = datetime.now(timezone.utc).date().isoformat()
    
    valid_sort_columns = {
        'name': 'c.name', 'street': 'c.street', 'city': 'c.city', 
        'voivodeship': 'c.voivodeship', 'phone': 'c.phone', 'email': 'c.email', 
        'nip': 'c.nip', 'www': 'c.www', 'notes': 'c.notes', 
        'reminder_date': 'c.reminder_date', 'last_note_date': 'h.last_note_date',
        'status': 'c.status', 'lead_score': 'c.name'
    }
    
    sql_sort_column = valid_sort_columns.get(sort_by, 'c.name')
    sql_order = 'DESC' if sort_order.lower() == 'desc' else 'ASC'

    base_query = f"""
    SELECT c.*, h.last_note, h.last_note_date, COALESCE(hc.note_count, 0) as note_count,
           CASE WHEN c.reminder_date IS NOT NULL AND c.reminder_date < ? THEN 1 ELSE 0 END as is_overdue
    FROM contacts c
    LEFT JOIN (
        SELECT contact_id, change_description as last_note, change_date as last_note_date,
               ROW_NUMBER() OVER(PARTITION BY contact_id ORDER BY change_date DESC) as rn
        FROM contact_history
    ) h ON c.id = h.contact_id AND h.rn = 1
    LEFT JOIN (
        SELECT contact_id, COUNT(*) as note_count FROM contact_history GROUP BY contact_id
    ) hc ON c.id = hc.contact_id
    """
    
    conditions = []
    params = [today_iso]

    if search_query:
        conditions.append('(c.name LIKE ? OR c.notes LIKE ? OR c.email LIKE ? OR c.nip LIKE ? OR c.street LIKE ? OR c.city LIKE ?)')
        search_term = f'%{search_query}%'
        params.extend([search_term] * 6)
        
    if filter_city:
        conditions.append('c.city LIKE ?')
        params.append(f'%{filter_city}%')

    if filter_status:
        conditions.append('c.status = ?')
        params.append(filter_status)

    if conditions:
        base_query += ' WHERE ' + ' AND '.join(conditions)
    
    base_query += f"""
        ORDER BY is_overdue DESC, 
                 CASE WHEN {sql_sort_column} IS NULL THEN 1 ELSE 0 END ASC, 
                 {sql_sort_column} {sql_order}
    """

    if limit is not None:
        try:
            limit_val = int(limit)
            if limit_val > 0:
                base_query += ' LIMIT ?'
                params.append(limit_val)
                if offset is not None:
                    try:
                        offset_val = int(offset)
                        if offset_val >= 0:
                            base_query += ' OFFSET ?'
                            params.append(offset_val)
                    except ValueError:
                        pass
        except ValueError:
            pass
    
    with get_db_conn() as conn:
        contacts = conn.execute(base_query, params).fetchall()
        
    # Zamień obiekty Row na słowniki z wyliczonym lead_score
    result = []
    for c in contacts:
        cdict = dict(c)
        cdict['lead_score'] = calculate_lead_score(cdict, cdict.get('note_count', 0))
        result.append(cdict)

    if sort_by == 'lead_score':
        reverse_flag = (sort_order.lower() != 'asc')
        result.sort(key=lambda item: item['lead_score'], reverse=reverse_flag)

    return result

def update_contact_coordinates(contact_id, lat, lng):
    """Zapisuje przeliczone współrzędne w bazie danych."""
    with get_db_conn() as conn:
        conn.execute("UPDATE contacts SET latitude = ?, longitude = ? WHERE id = ?", (lat, lng, contact_id))
        conn.commit()

def batch_geocode_contacts():
    """Przetwarza istniejące kontakty bez współrzędnych i uzupełnia latitude/longitude w bazie bez blokowania połączeń."""
    try:
        with get_db_conn() as conn:
            contacts = [dict(c) for c in conn.execute("SELECT id, street, city, voivodeship FROM contacts WHERE latitude IS NULL OR longitude IS NULL").fetchall()]

        for c in contacts:
            lat, lng = geocode_address(c['street'], c['city'], c['voivodeship'])
            if lat is not None and lng is not None:
                try:
                    with get_db_conn() as conn:
                        conn.execute("UPDATE contacts SET latitude = ?, longitude = ? WHERE id = ?", (lat, lng, c['id']))
                        conn.commit()
                except Exception:
                    pass
            time.sleep(1) # Przerwa szanująca darmowe API Nominatim
    except Exception:
        pass

def validate_contact_form(form):
    errors = []
    email = form.get('email', '').strip()
    nip = form.get('nip', '').strip()
    
    if not form.get('name', '').strip():
        errors.append("Nazwa kontaktu jest wymagana.")
        
    if email and not re.match(r"[^@]+@[^@]+\.[^@]+", email):
        errors.append("Niepoprawny format adresu e-mail.")
        
    if nip:
        clean_nip = nip.replace('-', '')
        if not clean_nip.isdigit() or len(clean_nip) != 10:
            errors.append("NIP musi składać się z dokładnie 10 cyfr.")
            
    return errors