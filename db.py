import os
import sqlite3
import re
from datetime import datetime, timezone
from flask import current_app

def get_db_conn():
    db_path = current_app.config['DATABASE_PATH']
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def init_db():
    with get_db_conn() as conn:
        cursor = conn.cursor()
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
                status TEXT NOT NULL DEFAULT 'nowy'
            )''')
        
        cursor.execute('''
            CREATE TABLE contact_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contact_id INTEGER NOT NULL,
                change_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                change_description TEXT NOT NULL,
                FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE
            )''')
        conn.commit()

def get_filtered_contacts_from_db(search_query, filter_city, filter_status, sort_by='name', sort_order='asc', limit=None, offset=None):
    today_iso = datetime.now(timezone.utc).date().isoformat()
    
    valid_sort_columns = {
        'name': 'c.name', 'street': 'c.street', 'city': 'c.city', 
        'voivodeship': 'c.voivodeship', 'phone': 'c.phone', 'email': 'c.email', 
        'nip': 'c.nip', 'www': 'c.www', 'notes': 'c.notes', 
        'reminder_date': 'c.reminder_date', 'last_note_date': 'h.last_note_date',
        'status': 'c.status'
    }
    
    sql_sort_column = valid_sort_columns.get(sort_by, 'c.name')
    sql_order = 'DESC' if sort_order.lower() == 'desc' else 'ASC'

    base_query = f"""
    SELECT c.*, h.last_note, h.last_note_date,
           CASE WHEN c.reminder_date IS NOT NULL AND c.reminder_date < ? THEN 1 ELSE 0 END as is_overdue
    FROM contacts c
    LEFT JOIN (
        SELECT contact_id, change_description as last_note, change_date as last_note_date,
               ROW_NUMBER() OVER(PARTITION BY contact_id ORDER BY change_date DESC) as rn
        FROM contact_history
    ) h ON c.id = h.contact_id AND h.rn = 1
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
        
    return contacts

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