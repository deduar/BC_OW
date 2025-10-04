import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Container, Box, AppBar, Toolbar, Typography, Button } from '@mui/material';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import FileUpload from './pages/FileUpload';
import Transactions from './pages/Transactions';
import Matches from './pages/Matches';
import { authService } from './services/authService';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      // Check if we have a token first
      if (!authService.isAuthenticated()) {
        setUser(null);
        setLoading(false);
        return;
      }
      
      const currentUser = await authService.getCurrentUser();
      setUser(currentUser);
    } catch (error) {
      // If token is invalid, clear it and logout
      authService.logout();
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (userData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    authService.logout();
    setUser(null);
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <Box sx={{ flexGrow: 1 }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Bank Reconciliation
          </Typography>
          <Button color="inherit" onClick={handleLogout}>
            Logout
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/upload" element={<FileUpload />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/matches" element={<Matches />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Container>
    </Box>
  );
}

export default App;