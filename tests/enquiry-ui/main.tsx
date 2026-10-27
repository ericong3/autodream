import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route} from 'react-router-dom';
import GarageCalendar from '../../src/pages/GarageCalendar';
import GarageEnquiries from '../../src/pages/GarageFollowUps';
import '../../src/index.css';
createRoot(document.getElementById('root')!).render(<BrowserRouter><Routes><Route path="/garage/calendar" element={<GarageCalendar/>}/><Route path="*" element={<GarageEnquiries/>}/></Routes></BrowserRouter>);
