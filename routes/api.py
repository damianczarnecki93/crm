import io
import csv
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify, url_for, Response
from db import get_db_conn

api_bp = Blueprint('api', __name__)

def get_stats_dict():
    with get_db_conn() as conn:
        stats = conn.execute("""
            SELECT
                COUNT(*) as total_count,
                COALESCE(SUM(CASE WHEN reminder_date = date('now') THEN 1 ELSE 0 END), 0) as reminders_today,
                COALESCE(SUM(CASE WHEN reminder_date IS NOT NULL AND reminder_date < date('now') THEN 1 ELSE 0 END), 0) as reminders_overdue,
                COALESCE(SUM(CASE WHEN status = 'nowy' THEN 1 ELSE 0 END), 0) as status_nowy,
                COALESCE(SUM(CASE WHEN status = 'aktywny' THEN 1 ELSE 0 END), 0) as status_aktywny,
                COALESCE(SUM(CASE WHEN status = 'kontakt' THEN 1 ELSE 0 END), 0) as status_kontakt,
                COALESCE(SUM(CASE WHEN status = 'lojalny' THEN 1 ELSE 0 END), 0) as status_lojalny,
                COALESCE(SUM(CASE WHEN status = 'utracony' THEN 1 ELSE 0 END), 0) as status_utracony,
                COALESCE(SUM(CASE WHEN status = 'nieaktywny' THEN 1 ELSE 0 END), 0) as status_nieaktywny
            FROM contacts
        """).fetchone()

        lost_reasons_rows = conn.execute("""
            SELECT COALESCE(NULLIF(lost_reason, ''), 'Nieokreślony') as reason, COUNT(*) as count
            FROM contacts WHERE status = 'utracony'
            GROUP BY reason
        """).fetchall()
        lost_reasons = {r['reason']: r['count'] for r in lost_reasons_rows}

    res = dict(stats) if stats else {}
    res['lost_reasons'] = lost_reasons
    return res

@api_bp.route('/api/stats')
def api_stats():
    return jsonify(get_stats_dict())

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


@api_bp.route('/contact/<int:contact_id>/add_sale', methods=['POST'])
def add_sale(contact_id):
    is_json_req = request.is_json or request.headers.get('X-Requested-With') == 'XMLHttpRequest' or 'application/json' in request.headers.get('Accept', '')
    data = request.json if request.is_json else request.form
    product_name = data.get('product_name', '').strip() if data else ''
    amount_str = str(data.get('amount', '')).strip() if data else ''
    sale_date = data.get('sale_date', '').strip() if data else ''
    notes = data.get('notes', '').strip() if data else ''

    if not product_name or not amount_str or not sale_date:
        msg = 'Wypełnij nazwę produktu, kwotę i datę.'
        if is_json_req:
            return jsonify({'success': False, 'message': msg}), 400
        flash(msg, 'warning')
        return redirect(url_for('contacts.contact_detail', contact_id=contact_id))

    try:
        amount = float(amount_str)
    except ValueError:
        msg = 'Niepoprawny format kwoty.'
        if is_json_req:
            return jsonify({'success': False, 'message': msg}), 400
        flash(msg, 'warning')
        return redirect(url_for('contacts.contact_detail', contact_id=contact_id))

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO sales_history (contact_id, product_name, amount, sale_date, notes) VALUES (?, ?, ?, ?, ?)',
            (contact_id, product_name, amount, sale_date, notes)
        )
        sale_id = cursor.lastrowid
        conn.commit()

    msg = 'Dodano wpis do historii sprzedaży.'
    if is_json_req:
        return jsonify({'success': True, 'message': msg, 'sale': {'id': sale_id, 'product_name': product_name, 'amount': amount, 'sale_date': sale_date, 'notes': notes}})

    flash(msg, 'success')
    return redirect(url_for('contacts.contact_detail', contact_id=contact_id))


@api_bp.route('/contact/<int:contact_id>/sales')
def get_sales(contact_id):
    with get_db_conn() as conn:
        sales = conn.execute('SELECT * FROM sales_history WHERE contact_id = ? ORDER BY sale_date DESC', (contact_id,)).fetchall()
    return jsonify([dict(s) for s in sales])


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