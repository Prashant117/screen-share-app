import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';
import { MeetingRoom } from './pages/MeetingRoom';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:id" element={<MeetingRoom />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

