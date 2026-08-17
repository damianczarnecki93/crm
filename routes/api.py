import io
import csv
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify, url_for, Response
from db import get_db_conn

api_bp = Blueprint('api', __name__)

@api_bp.route('/api/reminders')
def api_reminders():
    with get_db_conn() as conn:
        reminders_data = conn.execute("""
            SELECT c.id, c.name, c.reminder_date, h.last_note
            FROM contacts c
            LEFT JOIN (
                SELECT contact_id, change_description as last_note,
                       ROW_NUMBER() OVER(PARTITION BY contact_id ORDER BY change_date DESC) as rn
                FROM contact_history
            ) h ON c.id = h.contact_id AND h.rn = 1
            WHERE c.reminder_date IS NOT NULL AND c.reminder_date != ''
        """).fetchall()

    events = []
    for reminder in reminders_data:
        events.append({
            'title': reminder['name'],
            'start': reminder['reminder_date'],
            'url': url_for('contacts.contact_detail', contact_id=reminder['id']),
            'allDay': True,
            'extendedProps': {
                'last_note': reminder['last_note'] or ''
            }
        })
    return jsonify(events)


@api_bp.route('/export_csv')
def export_csv():
    search_query = request.args.get('q', '').strip()
    filter_city = request.args.get('filter_city', '').strip()
    filter_status = request.args.get('filter_status', '')

    base_query = """
    SELECT
        c.*,
        MAX(CASE WHEN h.rn = 1 THEN h.change_date || ': ' || h.change_description ELSE NULL END) as note_1,
        MAX(CASE WHEN h.rn = 2 THEN h.change_date || ': ' || h.change_description ELSE NULL END) as note_2,
        MAX(CASE WHEN h.rn = 3 THEN h.change_date || ': ' || h.change_description ELSE NULL END) as note_3
    FROM 
        contacts c
    LEFT JOIN (
        SELECT 
            contact_id, 
            substr(change_date, 1, 10) as change_date,
            change_description,
            ROW_NUMBER() OVER(PARTITION BY contact_id ORDER BY change_date DESC) as rn
        FROM 
            contact_history
    ) h ON c.id = h.contact_id AND h.rn IN (1, 2, 3)
    """
    
    conditions = []
    params = []

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
    
    base_query += ' GROUP BY c.id ORDER BY c.name ASC'

    with get_db_conn() as conn:
        contacts = conn.execute(base_query, params).fetchall()

    output = io.StringIO()
    writer = csv.writer(output, delimiter=';')

    headers = [
        'ID', 'Nazwa', 'Ulica', 'Miasto', 'Wojewodztwo', 'Telefon', 'Email', 
        'NIP', 'WWW', 'Uwagi', 'Data Przypomnienia', 'Status',
        'Ostatnia Notatka', 'Druga Notatka', 'Trzecia Notatka'
    ]
    writer.writerow(headers)

    for contact in contacts:
        writer.writerow([
            contact['id'], contact['name'], contact['street'], contact['city'], 
            contact['voivodeship'], contact['phone'], contact['email'], contact['nip'], 
            contact['www'], contact['notes'], contact['reminder_date'], contact['status'],
            contact['note_1'], contact['note_2'], contact['note_3']
        ])

    output.seek(0)
    current_date = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    return Response(
        output,
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment;filename=kontakty_{current_date}.csv"}
    )