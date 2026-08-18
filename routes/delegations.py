import urllib.request
import urllib.parse
import json
import math

from flask import Blueprint, request, jsonify, flash, redirect, url_for
from db import get_db_conn, geocode_address

delegations_bp = Blueprint('delegations', __name__)

def haversine_distance_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def calculate_osrm_route(coords):
    """
    coords = [(lat1, lng1), (lat2, lng2), ...]
    Gives overall distance (m), duration (sec), leg durations (sec), leg distances (m), and route geometry.
    Fallback to straight line estimation if OSRM is unreachable.
    """
    if len(coords) < 2:
        return {
            'total_distance_km': 0,
            'total_drive_duration_min': 0,
            'legs': [],
            'geometry': None
        }

    formatted_coords = ";".join([f"{lng},{lat}" for lat, lng in coords])
    url = f"http://router.project-osrm.org/route/v1/driving/{formatted_coords}?overview=full&geometries=geojson&steps=true"

    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'CRM-Python-Delegation-Planner/1.0'})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            if data and data.get('code') == 'Ok' and 'routes' in data and len(data['routes']) > 0:
                route = data['routes'][0]
                legs_info = []
                for leg in route.get('legs', []):
                    legs_info.append({
                        'distance_km': round(leg.get('distance', 0) / 1000.0, 1),
                        'duration_min': round(leg.get('duration', 0) / 60.0, 1)
                    })

                return {
                    'total_distance_km': round(route.get('distance', 0) / 1000.0, 1),
                    'total_drive_duration_min': round(route.get('duration', 0) / 60.0, 1),
                    'legs': legs_info,
                    'geometry': route.get('geometry')
                }
    except Exception:
        pass

    # Fallback, e.g. 70 km/h average driving speed
    legs_info = []
    total_dist = 0.0
    total_dur = 0.0

    for i in range(len(coords) - 1):
        lat1, lng1 = coords[i]
        lat2, lng2 = coords[i + 1]
        dist = haversine_distance_km(lat1, lng1, lat2, lng2) * 1.25 # detour factor
        dur_hrs = dist / 70.0
        dur_min = dur_hrs * 60.0

        legs_info.append({
            'distance_km': round(dist, 1),
            'duration_min': round(dur_min, 1)
        })
        total_dist += dist
        total_dur += dur_min

    coordinates = [[lng, lat] for lat, lng in coords]
    fallback_geometry = {
        'type': 'LineString',
        'coordinates': coordinates
    }

    return {
        'total_distance_km': round(total_dist, 1),
        'total_drive_duration_min': round(total_dur, 1),
        'legs': legs_info,
        'geometry': fallback_geometry
    }

# --- API ENDPOINTS ---

@delegations_bp.route('/api/delegations', methods=['GET'])
def list_delegations():
    with get_db_conn() as conn:
        delegations = conn.execute("SELECT * FROM delegations ORDER BY created_at DESC").fetchall()
    return jsonify([dict(d) for d in delegations])

@delegations_bp.route('/api/delegations', methods=['POST'])
def create_delegation():
    data = request.json or {}
    title = data.get('title', '').strip() or 'Nowa Delegacja'
    date_val = data.get('date', '').strip() or None

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO delegations (title, date) VALUES (?, ?)", (title, date_val))
        delegation_id = cursor.lastrowid
        conn.commit()

    return jsonify({'success': True, 'id': delegation_id, 'title': title, 'date': date_val})

@delegations_bp.route('/api/delegations/<int:delegation_id>', methods=['GET'])
def get_delegation(delegation_id):
    with get_db_conn() as conn:
        delegation = conn.execute("SELECT * FROM delegations WHERE id = ?", (delegation_id,)).fetchone()
        if not delegation:
            return jsonify({'success': False, 'message': 'Delegacja nie istnieje'}), 404

        stops = conn.execute(
            "SELECT * FROM delegation_stops WHERE delegation_id = ? ORDER BY stop_order ASC",
            (delegation_id,)
        ).fetchall()

    stops_list = [dict(s) for s in stops]

    # Calculate route using OSRM
    valid_coords = []
    for s in stops_list:
        if s.get('latitude') is not None and s.get('longitude') is not None:
            valid_coords.append((s['latitude'], s['longitude']))

    route_info = calculate_osrm_route(valid_coords)

    total_visit_minutes = sum(s.get('visit_duration_minutes', 0) or 0 for s in stops_list)
    total_time_minutes = round(route_info['total_drive_duration_min'] + total_visit_minutes, 1)

    return jsonify({
        'success': True,
        'delegation': dict(delegation),
        'stops': stops_list,
        'route': route_info,
        'summary': {
            'total_distance_km': route_info['total_distance_km'],
            'total_drive_duration_min': route_info['total_drive_duration_min'],
            'total_visit_duration_min': total_visit_minutes,
            'total_trip_duration_min': total_time_minutes
        }
    })

@delegations_bp.route('/api/delegations/<int:delegation_id>', methods=['DELETE'])
def delete_delegation(delegation_id):
    with get_db_conn() as conn:
        conn.execute("DELETE FROM delegations WHERE id = ?", (delegation_id,))
        conn.commit()
    return jsonify({'success': True})

@delegations_bp.route('/api/delegations/<int:delegation_id>/stops', methods=['POST'])
def add_stop(delegation_id):
    data = request.json or {}
    stop_type = data.get('stop_type', 'custom') # 'start', 'end', 'hotel', 'contact', 'custom'
    name = data.get('name', '').strip()
    address = data.get('address', '').strip()
    visit_duration = int(data.get('visit_duration_minutes', 0) or 0)
    contact_id = data.get('contact_id')

    lat = data.get('latitude')
    lng = data.get('longitude')

    if contact_id:
        with get_db_conn() as conn:
            c = conn.execute("SELECT * FROM contacts WHERE id = ?", (contact_id,)).fetchone()
            if c:
                if not name:
                    name = c['name']
                if not address:
                    address = f"{c['street'] or ''}, {c['city'] or ''}".strip(', ')
                lat = c['latitude']
                lng = c['longitude']

    if (lat is None or lng is None) and address:
        lat, lng = geocode_address(street=address, city='')

    with get_db_conn() as conn:
        max_order_row = conn.execute(
            "SELECT COALESCE(MAX(stop_order), 0) as max_ord FROM delegation_stops WHERE delegation_id = ?",
            (delegation_id,)
        ).fetchone()
        next_order = (max_order_row['max_ord'] if max_order_row else 0) + 1

        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO delegation_stops
            (delegation_id, stop_order, stop_type, name, address, latitude, longitude, visit_duration_minutes, contact_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (delegation_id, next_order, stop_type, name or 'Punkt', address, lat, lng, visit_duration, contact_id))
        conn.commit()

    return jsonify({'success': True})

@delegations_bp.route('/api/delegations/<int:delegation_id>/stops/reorder', methods=['POST'])
def reorder_stops(delegation_id):
    data = request.json or {}
    stop_ids = data.get('stop_ids', []) # list of stop IDs in new order

    with get_db_conn() as conn:
        for index, stop_id in enumerate(stop_ids, start=1):
            conn.execute(
                "UPDATE delegation_stops SET stop_order = ? WHERE id = ? AND delegation_id = ?",
                (index, stop_id, delegation_id)
            )
        conn.commit()

    return jsonify({'success': True})

@delegations_bp.route('/api/delegations/stops/<int:stop_id>', methods=['DELETE'])
def delete_stop(stop_id):
    with get_db_conn() as conn:
        conn.execute("DELETE FROM delegation_stops WHERE id = ?", (stop_id,))
        conn.commit()
    return jsonify({'success': True})

@delegations_bp.route('/api/delegations/stops/<int:stop_id>', methods=['PUT', 'POST'])
def update_stop(stop_id):
    data = request.json or {}
    visit_duration = int(data.get('visit_duration_minutes', 0) or 0)
    name = data.get('name')
    address = data.get('address')

    with get_db_conn() as conn:
        stop = conn.execute("SELECT * FROM delegation_stops WHERE id = ?", (stop_id,)).fetchone()
        if not stop:
            return jsonify({'success': False, 'message': 'Punkt nie istnieje'}), 404

        new_name = name if name is not None else stop['name']
        new_address = address if address is not None else stop['address']
        lat, lng = stop['latitude'], stop['longitude']

        if address is not None and address != stop['address']:
            lat, lng = geocode_address(street=address, city='')

        conn.execute("""
            UPDATE delegation_stops
            SET name = ?, address = ?, visit_duration_minutes = ?, latitude = ?, longitude = ?
            WHERE id = ?
        """, (new_name, new_address, visit_duration, lat, lng, stop_id))
        conn.commit()

    return jsonify({'success': True})
