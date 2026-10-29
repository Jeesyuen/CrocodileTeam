"""Manual end-to-end smoke run of both demo workflows (uses the seeded DB)."""
import json
import time

from fastapi.testclient import TestClient

from app.main import app
from app.services.graph import get_places

P = {p['name']: p for p in get_places()}
mmu, mall, hosp = P['Multimedia University'], P['DPulze Shopping Centre'], P['Hospital Cyberjaya']
pt = lambda p: {'lat': p['lat'], 'lon': p['lon']}
with TestClient(app) as c:
    def login(e):
        t = c.post('/api/auth/login', json={'email': e, 'password': 'demo1234'}).json()['token']
        return {'Authorization': f'Bearer {t}'}
    A, B = login('student.a@demo.saferoute.my'), login('student.b@demo.saferoute.my')
    D, O = login('driver@demo.saferoute.my'), login('operator@demo.saferoute.my')
    for mode, dest in (('walk', mall), ('drive', hosp)):
        t = time.time()
        r = c.post('/api/routes/compare', headers=B, json={'mode': mode, 'origin': pt(mmu), 'destination': pt(dest)})
        j = r.json(); print(mode, r.status_code, round(time.time() - t, 2), 's')
        for rt in j['routes']:
            print('  ', rt['preference'], rt['distance_m'], 'm', rt['duration_s'], 's score', rt['safety']['score'],
                  'haz', rt['hazard_ids'], 'same', rt['same_as'], '|', rt['explanation'])
    t = time.time(); r = c.get('/api/traffic/forecast', headers=D)
    print('forecast', r.status_code, round(time.time() - t, 2), json.dumps(r.json()['summary'], default=str))
    t = time.time(); r = c.post('/api/traffic/predict', headers=D, json={'origin': pt(mmu), 'destination': pt(hosp)}); j = r.json()
    print('predict', r.status_code, round(time.time() - t, 2), j.get('insights'), [x['duration_s'] for x in j.get('timeline', [])])
    t = time.time(); r = c.post('/api/traffic/best-departure', headers=D, json={'origin': pt(mmu), 'destination': pt(hosp)})
    print('best', r.status_code, round(time.time() - t, 2), r.json().get('insight'))
    # Demo A
    r = c.post('/api/routes/compare', headers=B, json={'mode': 'walk', 'origin': pt(mmu), 'destination': pt(mall)}).json()
    rt = next(x for x in r['routes'] if x['preference'] == 'balanced')
    c.post('/api/routes/sessions', headers=B, json={'mode': 'walk', 'preference': 'balanced', 'origin': pt(mmu),
                                                     'destination': pt(mall), 'edge_ids': rt['edge_ids'], 'segment_ids': rt['segment_ids']})
    g = rt['geometry'][len(rt['geometry']) // 2]
    with c.websocket_connect(f"/ws/alerts?token={B['Authorization'][7:]}") as ws:
        print(ws.receive_json())
        h = c.post('/api/hazards', headers=A, json={'category': 'fallen_tree', 'severity': 'high', 'lat': g[0], 'lon': g[1],
                                                    'obstruction': 'complete', 'description': 'Tree down'})
        print('hazard', h.status_code, h.json()['incident']['match_quality'], h.json()['merged_into_existing'])
        m = ws.receive_json()
        print('WS', m['event'], m['data'].get('notification', {}).get('title'), bool(m['data'].get('alternative')))
        hid = h.json()['incident']['id']
    print('student verify', c.post(f'/api/hazards/{hid}/verify', headers=B, json={'restriction': 'closed'}).status_code)
    v = c.post(f'/api/hazards/{hid}/verify', headers=O, json={'restriction': 'closed'})
    print('op verify', v.status_code, v.json()['restriction'], v.json()['certainty'])
    r2 = c.post('/api/routes/compare', headers=B, json={'mode': 'walk', 'origin': pt(mmu), 'destination': pt(mall)}).json()
    segs = {i['segment_id'] for i in v.json()['impacts'] if i['network'] == 'walk'}
    print('closure avoided:', all(not segs & set(x['segment_ids']) for x in r2['routes']))
    staff = c.get('/api/maintenance/staff', headers=O).json()
    print('assign', c.post(f'/api/hazards/{hid}/assign', headers=O, json={'assignee_id': staff[0]['id']}).status_code)
    M = login('maintenance@demo.saferoute.my')
    tasks = c.get('/api/maintenance/tasks', headers=M).json()
    tid = [t for t in tasks if t['incident']['id'] == hid][0]['id']
    print(c.patch(f'/api/maintenance/tasks/{tid}', headers=M, json={'status': 'in_progress'}).status_code,
          c.patch(f'/api/maintenance/tasks/{tid}', headers=M, json={'status': 'awaiting_clearance', 'resolution_notes': 'Tree removed'}).status_code,
          'maint clear ->', c.post(f'/api/hazards/{hid}/clear', headers=M, json={}).status_code)
    rs = c.post(f'/api/hazards/{hid}/resolve', headers=O, json={}).json(); print('resolved', rs['status'], rs['restriction'])
    cl = c.post(f'/api/hazards/{hid}/clear', headers=O, json={}).json(); print('cleared', cl['restriction'], [i['active'] for i in cl['impacts']])
    print(c.get('/api/dashboard/summary', headers=A).json()['active'], c.get('/api/dashboard/analytics', headers=O).status_code,
          c.get('/api/notifications', headers=B).json()['unread'])
