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

  const compareAlgorithms = async () => {
    try {
      setLoading(true);
      const response = await authService.api.post('/optimized-matches/compare-algorithms');
      console.log('Algorithm comparison:', response.data);
      alert(`Comparison Results:\nOriginal: ${response.data.comparison.original.matchesFound} matches in ${response.data.comparison.original.executionTime}ms\nOptimized: ${response.data.comparison.optimized.matchesFound} matches in ${response.data.comparison.optimized.executionTime}ms\nTime reduction: ${response.data.comparison.improvement.timeReduction}`);
      await loadStats();
    } catch (error) {
      console.error('Error comparing algorithms:', error);
    } finally {
      setLoading(false);
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
                variant="contained"
                onClick={runMatching}
                disabled={stats.transactions.fuerza_movil === 0 || stats.transactions.bank === 0}
                color="primary"
              >
                Run Optimized Matching
              </Button>
              <Button
                variant="outlined"
                onClick={compareAlgorithms}
                disabled={stats.transactions.fuerza_movil === 0 || stats.transactions.bank === 0}
                color="secondary"
              >
                Compare Algorithms
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

        {/* Algorithm Information */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2, backgroundColor: '#f5f5f5' }}>
            <Typography variant="h6" gutterBottom color="primary">
              🚀 Optimized Matching Algorithm
            </Typography>
            <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
              The system now uses an optimized 3-phase matching algorithm:
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="body2">
                <strong>Phase 1:</strong> Reference matching (highest priority)
              </Typography>
              <Typography variant="body2">
                <strong>Phase 2:</strong> Amount matching (for transactions without valid references)
              </Typography>
              <Typography variant="body2">
                <strong>Phase 3:</strong> AI embeddings (limited to special cases only)
              </Typography>
            </Box>
            <Typography variant="body2" color="textSecondary" sx={{ mt: 2, fontStyle: 'italic' }}>
              This approach significantly reduces processing time while maintaining high accuracy.
            </Typography>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}

export default Dashboard;