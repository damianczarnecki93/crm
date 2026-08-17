from flask import Blueprint, render_template, request
from db import get_db_conn, get_filtered_contacts_from_db

main_bp = Blueprint('main', __name__)

@main_bp.route('/')
def index():
    search_query = request.args.get("q", "").strip()
    filter_city = request.args.get("filter_city", "").strip()
    filter_status = request.args.get("filter_status", "")
    sort_by = request.args.get("sort_by", "name")
    sort_order = request.args.get("order", "asc")

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

    contacts = get_filtered_contacts_from_db(
        search_query, filter_city, filter_status, sort_by, sort_order
    )

    stats_dict = dict(stats) if stats else {}

    return render_template(
        "index.html",
        contacts=contacts,
        stats=stats_dict,
        search_query=search_query,
        filter_city=filter_city,
        filter_status=filter_status,
    )