import React, { useState, useEffect } from 'react';
import {
  Grid,
  Paper,
  Typography,
  Box,
  Button,
  Card,
  CardContent,
  LinearProgress
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/authService';

function Dashboard() {
  const [stats, setStats] = useState({
    files: { total: 0, processing: 0 },
    transactions: { total: 0, fuerza_movil: 0, bank: 0 },
    matches: { total: 0, highConfidence: 0, pending: 0 }
  });
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      console.log('Dashboard - loadStats called');
      console.log('Dashboard - authService:', authService);
      console.log('Dashboard - authService.api:', authService.api);
      
      const [filesRes, transactionsRes, matchesRes] = await Promise.all([
        authService.api.get('/files'),
        authService.api.get('/transactions/stats/summary'),
        authService.api.get('/matches/stats/summary')
      ]);

      const files = filesRes.data.files;
      const txStats = transactionsRes.data;
      const matchStats = matchesRes.data;

      setStats({
        files: {
          total: files.length,
          processing: files.filter(f => f.processingStatus === 'processing').length
        },
        transactions: {
          total: txStats.totalTransactions || 0,
          fuerza_movil: txStats.byType?.find(t => t._id === 'fuerza_movil')?.count || 0,
          bank: txStats.byType?.find(t => t._id === 'bank')?.count || 0
        },
        matches: {
          total: matchStats.matchingStats?.totalMatches || 0,
          highConfidence: matchStats.matchingStats?.highConfidenceMatches || 0,
          pending: matchStats.matchingStats?.mediumConfidenceMatches || 0
        }
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const runMatching = async () => {
    try {
      console.log('🔄 Starting matching process...');
      setLoading(true);

      // Check if user has transactions before running matching
      console.log('📊 Current stats:', stats.transactions);

      if (stats.transactions.fuerza_movil === 0 || stats.transactions.bank === 0) {
        console.warn('⚠️ No transactions available for matching');
        alert('No hay transacciones disponibles para hacer matching. Sube archivos primero.');
        return;
      }

      console.log('🚀 Calling matching API...');
      const response = await authService.api.post('/matches/run');
      console.log('✅ Matching API response:', response.data);

      console.log('🔄 Reloading stats...');
      await loadStats(); // Reload stats after matching
      console.log('✅ Stats reloaded');

      // Show success message
      alert(`Matching completado! Se encontraron ${response.data.matchesFound} matches.`);

    } catch (error) {
      console.error('❌ Error running matching:', error);
      console.error('❌ Error details:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });

      // Show user-friendly error message
      if (error.response?.status === 400) {
        alert(`Error: ${error.response.data.error}`);
      } else if (error.response?.status === 401) {
        alert('Error de autenticación. Por favor inicia sesión nuevamente.');
      } else if (error.response?.status === 500) {
        alert('Error interno del servidor. Por favor intenta nuevamente.');
      } else {
        alert('Error ejecutando el matching. Por favor intenta nuevamente.');
      }
    } finally {
      setLoading(false);
      console.log('🏁 Matching process finished');
    }
  };

  if (loading) {
    return <LinearProgress />;
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Dashboard
      </Typography>

      <Grid container spacing={3}>
        {/* Files Stats */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Files
              </Typography>
              <Typography variant="h5">
                {stats.files.total}
              </Typography>
              {stats.files.processing > 0 && (
                <Typography color="textSecondary">
                  {stats.files.processing} processing
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Transactions Stats */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Transactions
              </Typography>
              <Typography variant="h5">
                {stats.transactions.total}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                {stats.transactions.fuerza_movil} Fuerza Movil, {stats.transactions.bank} Bank
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Matches Stats */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Matches
              </Typography>
              <Typography variant="h5">
                {stats.matches.total}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                {stats.matches.highConfidence} high confidence, {stats.matches.pending} pending review
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Quick Actions */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Quick Actions
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                onClick={() => navigate('/upload')}
              >
                Upload Files
              </Button>
              <Button
                variant="outlined"
                onClick={runMatching}
                disabled={stats.transactions.fuerza_movil === 0 || stats.transactions.bank === 0 || loading}
              >
                {loading ? 'Running...' : 'Run Matching'}
              </Button>
              <Button
                variant="outlined"
                onClick={() => navigate('/transactions')}
              >
                View Transactions
              </Button>
              <Button
                variant="outlined"
                onClick={() => navigate('/matches')}
              >
                Review Matches
              </Button>
            </Box>
          </Paper>
        </Grid>

        {/* Progress Overview */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Reconciliation Progress
            </Typography>
            {stats.transactions.total > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" color="textSecondary">
                  Matched: {stats.matches.total} / {stats.transactions.fuerza_movil} transactions
                  ({((stats.matches.total / stats.transactions.fuerza_movil) * 100).toFixed(1)}%)
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={(stats.matches.total / stats.transactions.fuerza_movil) * 100}
                  sx={{ mt: 1, height: 8, borderRadius: 4 }}
                />
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}

export default Dashboard;