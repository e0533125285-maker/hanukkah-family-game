import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import {
  ArrowLeft, CheckCircle2, Copy, Crown, Flame, LoaderCircle, PartyPopper,
  Play, Plus, ShieldCheck, Sparkles, Trophy, Users, Wifi, WifiOff
} from 'lucide-react';
import './style.css';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

const starterQuestions = [
  { prompt: 'כמה נרות חנוכה מדליקים בסך הכול בשמונת הימים, בלי השמשים?', options: ['36', '40', '44', '48'], correct: 0, points: 100 },
  { prompt: 'מה מוסיפים בתפילה ובברכת המזון בחנוכה?', options: ['יעלה ויבוא', 'על הניסים', 'עננו', 'אב הרחמים'], correct: 1, points: 100 },
  { prompt: 'איך נקראים המטבעות שמקובל לתת בחנוכה?', options: ['דמי פורים', 'מעות חיטים', 'דמי חנוכה', 'מתנות לאביונים'], correct: 2, points: 100 },
  { prompt: 'כמה ימים נמשך חג החנוכה?', options: ['שבעה', 'שמונה', 'תשעה', 'עשרה'], correct: 1, points: 100 },
  { prompt: 'באיזה כלי משחקים בסביבון?', options: ['בקלפים', 'בקוביות', 'בסביבון', 'בכדור'], correct: 2, points: 100 }
];

function App() {
  const [screen, setScreen] = useState('home');
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [configError, setConfigError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [room, setRoom] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [participantId, setParticipantId] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [answerKeys, setAnswerKeys] = useState({});
  const [selected, setSelected] = useState(null);
  const [score, setScore] = useState(0);
  const [newPrompt, setNewPrompt] = useState('');
  const [newOptions, setNewOptions] = useState(['', '', '', '']);
  const [newCorrect, setNewCorrect] = useState(0);

  useEffect(() => {
    if (!supabase) {
      setConfigError('כדי להפעיל משחק אמיתי צריך להגדיר Supabase. כרגע אין חיבור למסד נתונים.');
      setAuthReady(true);
      return;
    }
    let alive = true;
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (error) setConfigError(error.message);
      let current = data?.session?.user ?? null;
      if (!current) {
        const result = await supabase.auth.signInAnonymously();
        if (result.error) {
          if (alive) setConfigError('לא ניתן להתחבר. יש להפעיל Anonymous Sign-ins ב-Supabase: ' + result.error.message);
          current = null;
        } else current = result.data.user;
      }
      if (alive) {
        setUser(current);
        setAuthReady(true);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) setUser(session?.user ?? null);
    });
    return () => {
      alive = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  const loadParticipants = useCallback(async (id) => {
    if (!supabase || !id) return;
    const { data, error } = await supabase.from('game_participants')
      .select('id,display_name,score,team').eq('room_id', id).order('score', { ascending: false });
    if (!error && data) setParticipants(data);
  }, []);

  const loadRoomContent = useCallback(async (id, isHost) => {
    if (!supabase || !id) return;
    const [{ data: roomData }, { data: questionData }] = await Promise.all([
      supabase.from('rooms').select('*').eq('id', id).single(),
      supabase.from('questions').select('id,position,prompt,options,points').eq('room_id', id).order('position')
    ]);
    if (roomData) setRoom(roomData);
    if (questionData) setQuestions(questionData);
    await loadParticipants(id);
    if (isHost) {
      const { data: keys } = await supabase.from('question_keys').select('question_id,correct_option').eq('room_id', id);
      if (keys) setAnswerKeys(Object.fromEntries(keys.map(k => [k.question_id, k.correct_option])));
    }
  }, [loadParticipants]);

  useEffect(() => {
    if (!supabase || !roomId) return;
    const channel = supabase.channel('game-room-' + roomId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: 'id=eq.' + roomId }, payload => {
        if (payload.new) setRoom(payload.new);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_participants', filter: 'room_id=eq.' + roomId }, () => loadParticipants(roomId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'questions', filter: 'room_id=eq.' + roomId }, () => {
        supabase.from('questions').select('id,position,prompt,options,points').eq('room_id', roomId).order('position')
          .then(({ data }) => data && setQuestions(data));
      })
      .subscribe();
    loadParticipants(roomId);
    return () => { supabase.removeChannel(channel); };
  }, [roomId, loadParticipants]);

  useEffect(() => {
    setSelected(null);
    if (!room || !questions.length) return;
  }, [room?.current_question_position, questions.length]);

  const sorted = useMemo(() => [...participants].sort((a, b) => b.score - a.score), [participants]);
  const activeQuestion = questions.find(q => q.position === room?.current_question_position) ?? questions[0] ?? null;
  const isHost = Boolean(user && room && room.owner_id === user.id);

  async function signInWithGoogle() {
    if (!supabase) {
      setNotice('החיבור לשרת עדיין לא הוגדר.');
      return;
    }
    setBusy(true);
    setNotice('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) {
      setBusy(false);
      setNotice('לא הצלחנו להתחבר עם Google: ' + error.message);
    }
  }

  async function createRoom() {
    if (!supabase || !user) return setNotice('החיבור עדיין לא מוכן. בדקו את הגדרות Supabase.');
    setBusy(true); setNotice('');
    try {
      let created = null;
      for (let attempt = 0; attempt < 5 && !created; attempt++) {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const result = await supabase.from('rooms')
          .insert({ code, owner_id: user.id, status: 'lobby', current_question_position: 0 })
          .select('*').single();
        if (!result.error) created = result.data;
        else if (result.error.code !== '23505') throw result.error;
      }
      if (!created) throw new Error('לא הצלחנו ליצור קוד חדר. נסו שוב.');
      const questionRows = starterQuestions.map((q, position) => ({
        room_id: created.id, position, prompt: q.prompt, options: q.options, points: q.points
      }));
      const { data: inserted, error: qError } = await supabase.from('questions').insert(questionRows).select('id,position');
      if (qError) throw qError;
      const keys = inserted.map(row => ({
        room_id: created.id,
        question_id: row.id,
        correct_option: starterQuestions[row.position].correct
      }));
      const { error: keyError } = await supabase.from('question_keys').insert(keys);
      if (keyError) throw keyError;
      setRoomId(created.id);
      setRoom(created);
      setQuestions([]);
      setAnswerKeys({});
      await loadRoomContent(created.id, true);
      setScreen('host');
      setNotice('החדר נוצר. אפשר לשלוח למשפחה את הקוד.');
    } catch (error) {
      setNotice('שגיאה ביצירת החדר: ' + (error.message || 'נסו שוב'));
    } finally { setBusy(false); }
  }

  async function joinRoom() {
    if (!supabase) return setNotice('המשחק עדיין לא מחובר למסד נתונים.');
    if (!name.trim() || !/^\d{6}$/.test(roomCodeInput.trim())) return setNotice('יש למלא שם וקוד בן 6 ספרות.');
    setBusy(true); setNotice('');
    try {
      const { data, error } = await supabase.rpc('join_game_room', {
        p_room_code: roomCodeInput.trim(), p_display_name: name.trim()
      });
      if (error) throw error;
      const joined = Array.isArray(data) ? data[0] : data;
      if (!joined?.room_id) throw new Error('לא התקבל אישור הצטרפות מהשרת.');
      setRoomId(joined.room_id);
      setRoom({ id: joined.room_id, code: roomCodeInput.trim(), status: 'lobby', current_question_position: 0 });
      setParticipantId(joined.participant_id);
      setScore(0);
      await loadRoomContent(joined.room_id, false);
      setScreen('play');
      setNotice('הצטרפת בהצלחה! מחכים שמנהל המשחק יתחיל.');
    } catch (error) {
      setNotice('לא הצלחנו להצטרף: ' + (error.message || 'בדקו את הקוד'));
    } finally { setBusy(false); }
  }

  async function startGame() {
    if (!room || !isHost) return;
    setBusy(true);
    const { error } = await supabase.from('rooms').update({ status: 'playing', current_question_position: 0 }).eq('id', room.id);
    setBusy(false);
    if (error) setNotice('לא ניתן להתחיל: ' + error.message);
    else setNotice('המשחק התחיל!');
  }

  async function advanceGame() {
    if (!room || !isHost) return;
    const last = questions.length - 1;
    const nextStatus = room.current_question_position >= last ? 'finished' : 'playing';
    const nextPosition = nextStatus === 'finished' ? room.current_question_position : room.current_question_position + 1;
    setBusy(true);
    const { error } = await supabase.from('rooms').update({
      status: nextStatus, current_question_position: nextPosition
    }).eq('id', room.id);
    setBusy(false);
    if (error) setNotice('לא ניתן לעבור הלאה: ' + error.message);
    else setNotice(nextStatus === 'finished' ? 'החידון הסתיים! כל הכבוד לכולם.' : 'עברנו לשאלה הבאה.');
  }

  async function submitAnswer(optionIndex) {
    if (!room || !activeQuestion || selected !== null || room.status !== 'playing') return;
    setSelected(optionIndex);
    const { data, error } = await supabase.rpc('submit_game_answer', {
      p_room_code: room.code,
      p_question_id: activeQuestion.id,
      p_selected_option: optionIndex
    });
    if (error) {
      setSelected(null);
      setNotice(error.message.includes('duplicate key') ? 'כבר ענית על השאלה הזאת.' : 'התשובה לא נשמרה: ' + error.message);
      return;
    }
    const result = Array.isArray(data) ? data[0] : data;
    setScore(result?.total_score ?? score);
    setNotice(result?.correct ? 'תשובה נכונה! +' + result.awarded + ' נקודות 🎉' : 'לא הפעם. ממשיכים לשאלה הבאה!');
    await loadParticipants(room.id);
  }

  async function addQuestion() {
    if (!room || !isHost || !newPrompt.trim() || newOptions.some(o => !o.trim())) {
      setNotice('יש למלא שאלה וארבע תשובות.'); return;
    }
    setBusy(true);
    try {
      const position = questions.length;
      const { data, error } = await supabase.from('questions').insert({
        room_id: room.id, position, prompt: newPrompt.trim(),
        options: newOptions.map(o => o.trim()), points: 100
      }).select('id').single();
      if (error) throw error;
      const { error: keyError } = await supabase.from('question_keys').insert({
        room_id: room.id, question_id: data.id, correct_option: Number(newCorrect)
      });
      if (keyError) throw keyError;
      setNewPrompt(''); setNewOptions(['', '', '', '']); setNewCorrect(0);
      await loadRoomContent(room.id, true);
      setNotice('השאלה נוספה בהצלחה.');
    } catch (error) { setNotice('לא הצלחנו להוסיף שאלה: ' + error.message); }
    finally { setBusy(false); }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(room?.code || '');
      setNotice('קוד המשחק הועתק.');
    } catch { setNotice('הקוד: ' + room?.code); }
  }

  function resetToHome() {
    setScreen('home'); setRoom(null); setRoomId(null); setParticipantId(null);
    setParticipants([]); setQuestions([]); setAnswerKeys({}); setNotice('');
    setName(''); setRoomCodeInput('');
  }

  if (!authReady) return <div className="loading-screen"><LoaderCircle className="spin" size={34}/> מתחברים למשחק...</div>;

  return <div className="app-shell" dir="rtl">
    <header className="topbar">
      <button className="brand brand-button" onClick={resetToHome} aria-label="חזרה לבית">
        <span className="brand-mark">🕎</span><span><b>החנוכיאדה</b><small>המשפחתית הגדולה</small></span>
      </button>
      <div className="live-pill">{roomId ? <><Wifi size={15}/> חדר פעיל</> : <><WifiOff size={15}/> מוכנים לחגיגה</>}</div>
    </header>

    <main>
      {configError && <div className="config-alert"><ShieldCheck size={18}/><span>{configError}</span></div>}

      {screen === 'home' && <section className="hero">
        <div className="eyebrow"><Sparkles size={15}/> חג של אור, צחוק ומשפחה</div>
        <h1>החנוכיאדה<br/><em>המשפחתית הגדולה</em></h1>
        <p className="intro">כולם משתתפים, כולם משחקים, וכל רגע הופך לזיכרון משפחתי.</p>
        <div className="hero-art"><div className="glow"></div><div className="menorah">✦ 🕎 ✦</div><div className="stars">✧　✦　✧　✦　✧</div></div>
        <div className="action-grid">
          <button className="google-button" onClick={signInWithGoogle} disabled={busy || !supabase}>
            <span className="google-g" aria-hidden="true">G</span>
            {busy ? 'מתחברים...' : 'התחברות באמצעות Google'}
          </button>
          <button className="primary" onClick={() => { setScreen('join'); setNotice(''); }}><Users/> אני רוצה להצטרף למשחק <ArrowLeft/></button>
          <button className="secondary" onClick={createRoom} disabled={busy || !supabase}><Crown/> {busy ? 'יוצרים חדר...' : 'כניסת מנהל ופתיחת משחק'}</button>
        </div>
        <div className="feature-row"><span><Flame/> משחקי חנוכה</span><span><Trophy/> ניקוד חי</span><span><ShieldCheck/> חדר פרטי</span></div>
        {notice && <p className="notice">{notice}</p>}
      </section>}

      {screen === 'join' && <section className="panel narrow">
        <button className="back" onClick={() => { setScreen('home'); setNotice(''); }}>→ חזרה</button>
        <div className="eyebrow">ברוכים הבאים למשחק</div><h2>מצטרפים לחגיגה</h2>
        <label>איך קוראים לך?</label><input value={name} onChange={e => setName(e.target.value)} placeholder="השם או הכינוי שלך" maxLength={32}/>
        <label>קוד המשחק</label><input value={roomCodeInput} onChange={e => setRoomCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="קוד בן 6 ספרות" inputMode="numeric" maxLength={6}/>
        <button className="primary full" onClick={joinRoom} disabled={busy || !supabase}>{busy ? 'מתחברים...' : 'כניסה למשחק'} <ArrowLeft/></button>
        {notice && <p className="notice">{notice}</p>}
      </section>}

      {screen === 'host' && room && <section className="host-wrap">
        <div className="panel host-panel">
          <div className="eyebrow"><Crown size={15}/> מסך מנהל</div><h2>החדר שלך מוכן!</h2>
          <p>שלחו למשפחה את קוד המשחק. כל אחד יכול להצטרף מהטלפון.</p>
          <div className="room-code"><small>קוד המשחק</small><strong>{room.code}</strong><button onClick={copyCode} aria-label="העתקת קוד"><Copy/></button></div>
          <div className="stats"><div><strong>{participants.length}</strong><small>משתתפים</small></div><div><strong>{questions.length}</strong><small>שאלות</small></div><div><strong>{room.status === 'playing' ? 'פעיל' : room.status === 'finished' ? 'הסתיים' : 'ממתין'}</strong><small>מצב החדר</small></div></div>
          {room.status === 'lobby' && <button className="primary full" onClick={startGame} disabled={busy}><Play/> התחלת החידון</button>}
          {room.status === 'playing' && <button className="primary full" onClick={advanceGame} disabled={busy}>{room.current_question_position === questions.length - 1 ? 'סיום החידון' : 'לשאלה הבאה'} <ArrowLeft/></button>}
          {room.status === 'playing' && activeQuestion && <div className="question-card host-current-question">
            <small>שאלה {activeQuestion.position + 1} מתוך {questions.length}</small>
            <h3>{activeQuestion.prompt}</h3>
            {activeQuestion.options.map((option, i) => <div className={'answer-line ' + (answerKeys[activeQuestion.id] === i ? 'correct' : '')} key={i}>{option}{answerKeys[activeQuestion.id] === i ? ' ✓ תשובה נכונה' : ''}</div>)}
          </div>}
          {room.status === 'finished' && <div className="finished"><PartyPopper/> החידון הסתיים. חג שמח!</div>}
          {notice && <p className="notice">{notice}</p>}
          {room.status === 'lobby' && <div className="question-editor">
            <h3><Plus/> הוספת שאלה משלכם</h3>
            <input value={newPrompt} onChange={e => setNewPrompt(e.target.value)} placeholder="כתבו את השאלה"/>
            {newOptions.map((option, i) => <div className="option-edit" key={i}><input value={option} onChange={e => setNewOptions(old => old.map((v, n) => n === i ? e.target.value : v))} placeholder={'תשובה ' + (i + 1)}/><label><input type="radio" name="correct" checked={Number(newCorrect) === i} onChange={() => setNewCorrect(i)}/> נכונה</label></div>)}
            <button className="secondary full" onClick={addQuestion} disabled={busy}>שמירת השאלה</button>
          </div>}
        </div>
        <div className="panel"><h3><Trophy/> טבלת מובילים</h3>
          {sorted.length ? sorted.map((p, i) => <div className="leader" key={p.id}><b>{i + 1}. {p.display_name}</b><span>{p.score} נק׳</span></div>) : <p className="muted">המשתתפים יופיעו כאן לאחר שיצטרפו.</p>}
          <h3 className="subhead"><Users/> משתתפים ({participants.length})</h3>
          <div className="participant-list">{participants.map(p => <span key={p.id}>{p.display_name}</span>)}</div>
        </div>
      </section>}

      {screen === 'play' && room && <section className="panel narrow">
        <div className="eyebrow"><Users size={15}/> שלום {name}</div>
        <h2>{room.status === 'lobby' ? 'הצטרפת בהצלחה!' : room.status === 'finished' ? 'המשחק הסתיים!' : 'בהצלחה במשחק!'}</h2>
        <div className="score-chip"><Trophy/> {score} נקודות</div>
        {room.status === 'lobby' && <div className="waiting"><LoaderCircle className="spin"/> מחכים שמנהל המשחק יתחיל...</div>}
        {room.status === 'finished' && <div className="finished"><PartyPopper/> כל הכבוד על ההשתתפות!</div>}
        {room.status === 'playing' && activeQuestion && <>
          <small className="question-count">שאלה {activeQuestion.position + 1} מתוך {questions.length}</small>
          <h3>{activeQuestion.prompt}</h3>
          <div className="answers">{activeQuestion.options.map((option, i) => <button key={i} disabled={selected !== null} className={'answer ' + (selected === i ? 'selected' : '')} onClick={() => submitAnswer(i)}>{option}</button>)}</div>
          {selected !== null && <p className="waiting">התשובה נקלטה. מחכים לשאלה הבאה...</p>}
        </>}
        {notice && <p className="notice">{notice}</p>}
        <div className="player-leaderboard">
          <h3><Trophy/> מובילים כרגע</h3>
          {sorted.slice(0, 5).length ? sorted.slice(0, 5).map((p, i) => (
            <div className="leader" key={p.id}><b>{i + 1}. {p.display_name}</b><span>{p.score} נק׳</span></div>
          )) : <p className="muted">טבלת המובילים תתעדכן כשהמשתתפים יצברו נקודות.</p>}
        </div>
      </section>}
    </main>
    <footer>נוצר באהבה למשפחה ❤️ · חג חנוכה שמח</footer>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
