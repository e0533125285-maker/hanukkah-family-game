import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { Sparkles, Trophy, Users, ShieldCheck, Zap, Copy, Play, Plus, Crown, Flame, PartyPopper, Wifi, WifiOff, ArrowLeft, CheckCircle2 } from 'lucide-react';
import './style.css';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
const starterQuestions = [
  { id: 'q1', question: 'כמה נרות מדליקים בסך הכול בכל שמונת ימי חנוכה, בלי השמשים?', answers: ['36', '40', '44', '48'], correct: 2, points: 100 },
  { id: 'q2', question: 'מה מוסיפים בתפילה ובברכת המזון בחנוכה?', answers: ['יעלה ויבוא', 'על הניסים', 'הלל הגדול', 'עננו'], correct: 1, points: 100 },
  { id: 'q3', question: 'איך נקראים המטבעות שמקובל לתת בחנוכה?', answers: ['דמי פורים', 'מעות חיטים', 'דמי חנוכה', 'מתנות לאביונים'], correct: 2, points: 100 }
];

function App() {
  const [screen, setScreen] = useState('home');
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [hostMode, setHostMode] = useState(false);
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [questions, setQuestions] = useState(starterQuestions);
  const [active, setActive] = useState(0);
  const [answer, setAnswer] = useState(null);
  const [score, setScore] = useState(0);
  const [notice, setNotice] = useState('');
  const [newQuestion, setNewQuestion] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase || !roomCode) return;
    const channel = supabase.channel('room-' + roomCode)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, payload => {
        if (payload.new?.room_code === roomCode || payload.old?.room_code === roomCode) loadParticipants();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state', filter: 'room_code=eq.' + roomCode }, payload => {
        if (payload.new?.active_question !== undefined) setActive(payload.new.active_question);
      }).subscribe(status => setConnected(status === 'SUBSCRIBED'));
    loadParticipants();
    return () => { supabase.removeChannel(channel); };
  }, [roomCode]);

  async function loadParticipants() {
    if (!supabase) return;
    const { data } = await supabase.from('participants').select('id,name,score,team').eq('room_code', roomCode).order('score', { ascending: false });
    if (data) setParticipants(data);
  }

  async function joinRoom() {
    if (!name.trim() || !roomCode.trim()) return setNotice('יש למלא שם וקוד משחק');
    if (!supabase) { setNotice('החיבור בזמן אמת עדיין לא הוגדר. יש להגדיר Supabase כדי לפתוח משחק אמיתי.'); return; }
    setBusy(true);
    const { error } = await supabase.from('participants').insert({ room_code: roomCode.trim().toUpperCase(), name: name.trim(), score: 0 });
    setBusy(false);
    if (error) return setNotice('לא הצלחנו להצטרף: ' + error.message);
    setScreen('play');
    setNotice('הצטרפת בהצלחה! בהצלחה במשחק 🕎');
  }

  async function createRoom() {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setRoomCode(code);
    setHostMode(true);
    setScreen('host');
    if (supabase) {
      const { error } = await supabase.from('game_state').upsert({ room_code: code, active_question: 0, is_open: true });
      if (error) setNotice('נוצר קוד, אך שמירת החדר נכשלה: ' + error.message);
      else setNotice('החדר נוצר. שתפו את הקוד עם המשפחה.');
    } else setNotice('תצוגת הכנה בלבד: יש לחבר Supabase כדי שהמשפחה תוכל להצטרף בזמן אמת.');
  }

  async function submitAnswer(index) {
    setAnswer(index);
    const current = questions[active];
    if (index === current.correct) {
      setScore(s => s + current.points);
      setNotice('כל הכבוד! תשובה נכונה 🎉');
    } else setNotice('לא הפעם — ממשיכים לשאלה הבאה!');
  }

  async function nextQuestion() {
    const next = Math.min(active + 1, questions.length - 1);
    setActive(next);
    setAnswer(null);
    if (supabase && roomCode) await supabase.from('game_state').upsert({ room_code: roomCode, active_question: next, is_open: true });
  }

  const sorted = useMemo(() => [...participants].sort((a,b) => b.score-a.score), [participants]);
  const code = roomCode || '------';

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">🕎</span><div><b>החנוכיאדה</b><small>המשפחתית הגדולה</small></div></div><div className="live-pill">{supabase && connected ? <><Wifi size={15}/> מחובר בזמן אמת</> : <><WifiOff size={15}/> מצב הכנה</>}</div></header>
    <main>
      {screen === 'home' && <section className="hero">
        <div className="eyebrow"><Sparkles size={15}/> חג של אור, צחוק ומשפחה</div>
        <h1>החנוכיאדה<br/><em>המשפחתית הגדולה</em></h1>
        <p className="intro">כולם משתתפים, כולם משחקים, וכל רגע הופך לזיכרון משפחתי.</p>
        <div className="hero-art"><div className="glow"></div><div className="menorah">✦ 🕎 ✦</div><div className="stars">✧　✦　✧　✦　✧</div></div>
        <div className="action-grid">
          <button className="primary" onClick={() => {setHostMode(false);setScreen('join')}}><Users/> אני רוצה להצטרף למשחק <ArrowLeft/></button>
          <button className="secondary" onClick={() => createRoom()}><Crown/> כניסת מנהל ופתיחת משחק</button>
        </div>
        <div className="feature-row"><span><Zap/> משחקים חיים</span><span><Trophy/> ניקוד ותחרות</span><span><ShieldCheck/> פשוט ובטוח</span></div>
      </section>}
      {screen === 'join' && <section className="panel narrow"><button className="back" onClick={() => setScreen('home')}>→ חזרה</button><div className="eyebrow">ברוכים הבאים למשחק</div><h2>מצטרפים לחגיגה</h2><label>איך קוראים לך?</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="השם או הכינוי שלך" maxLength={32}/><label>קוד המשחק</label><input value={roomCode} onChange={e=>setRoomCode(e.target.value)} placeholder="קוד בן 6 ספרות" inputMode="numeric" maxLength={6}/><button className="primary full" disabled={busy} onClick={joinRoom}>{busy?'מתחברים...':'כניסה למשחק'} <ArrowLeft/></button>{notice && <p className="notice">{notice}</p>}</section>}
      {screen === 'host' && <section className="host-wrap"><div className="panel host-panel"><div className="eyebrow"><Crown size={15}/> מסך מנהל</div><h2>החדר שלך מוכן!</h2><p>שלחו למשפחה את הקישור ואת קוד המשחק.</p><div className="room-code"><small>קוד המשחק</small><strong>{code}</strong><button onClick={()=>navigator.clipboard?.writeText(code)} aria-label="העתקת קוד"><Copy/></button></div><div className="stats"><div><strong>{participants.length}</strong><small>משתתפים</small></div><div><strong>{questions.length}</strong><small>שאלות מוכנות</small></div><div><strong>100</strong><small>יעד משתתפים</small></div></div><button className="primary full" onClick={()=>setScreen('host-game')}><Play/> התחלת החידון</button><p className="notice">{notice}</p></div><div className="panel"><h3><Trophy/> טבלת מובילים</h3>{sorted.length ? sorted.map((p,i)=><div className="leader" key={p.id}><b>{i+1}. {p.name}</b><span>{p.score} נק׳</span></div>) : <p className="muted">המשתתפים יופיעו כאן לאחר שיצטרפו.</p>}</div></section>}
      {screen === 'host-game' && <section className="panel"><div className="eyebrow">סבב החידון</div><h2>ניהול השאלות</h2><div className="question-card"><small>שאלה {active+1} מתוך {questions.length}</small><h3>{questions[active].question}</h3>{questions[active].answers.map((a,i)=><div className={'answer-line '+(i===questions[active].correct?'correct':'')} key={i}>{a}{i===questions[active].correct?' ✓':''}</div>)}</div><button className="primary full" onClick={nextQuestion} disabled={active===questions.length-1}>לשאלה הבאה <ArrowLeft/></button><h3>הוספת שאלה</h3><input value={newQuestion} onChange={e=>setNewQuestion(e.target.value)} placeholder="כתבו שאלה חדשה"/><button className="secondary full" onClick={()=>{if(newQuestion.trim()){setQuestions(q=>[...q,{id:crypto.randomUUID(),question:newQuestion,answers:['תשובה א','תשובה ב','תשובה ג','תשובה ד'],correct:0,points:100}]);setNewQuestion('')}}}><Plus/> הוספת שאלה</button><button className="back" onClick={()=>setScreen('host')}>חזרה ללוח המנהל</button></section>}
      {screen === 'play' && <section className="panel narrow"><div className="eyebrow">המשחק התחיל</div><h2>בהצלחה, {name}!</h2><div className="score-chip"><Trophy/> {score} נקודות</div><small>שאלה {active+1} מתוך {questions.length}</small><h3>{questions[active].question}</h3><div className="answers">{questions[active].answers.map((a,i)=><button key={i} disabled={answer!==null} className={'answer '+(answer===i?'selected':'')} onClick={()=>submitAnswer(i)}>{a}</button>)}</div>{notice&&<p className="notice">{notice}</p>}<button className="secondary full" onClick={()=>{setAnswer(null);setActive(a=>Math.min(a+1,questions.length-1))}}>המשך</button></section>}
    </main>
    <footer>נוצר באהבה למשפחה ❤️ · חג חנוכה שמח</footer>
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);