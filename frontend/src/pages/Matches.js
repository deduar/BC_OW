import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  LinearProgress,
  Alert
} from '@mui/material';
import { Check as CheckIcon, Close as CloseIcon } from '@mui/icons-material';
import { authService } from '../services/authService';

function Matches() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [feedbackDialog, setFeedbackDialog] = useState({
    open: false,
    match: null,
    action: '',
    explanation: ''
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadMatches();
  }, []);

  const loadMatches = async () => {
    try {
      setLoading(true);
      const response = await authService.api.get('/matches');
      setMatches(response.data.matches);
    } catch (error) {
      console.error('Error loading matches:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatAmount = (amount) => {
    return new Intl.NumberFormat('es-VE', {
      style: 'currency',
      currency: 'VES'
    }).format(amount);
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('es-VE');
  };

  const getConfidenceColor = (confidence) => {
    if (confidence >= 0.8) return 'success';
    if (confidence >= 0.6) return 'warning';
    return 'error';
  };

  const getConfidenceLabel = (confidence) => {
    if (confidence >= 0.8) return 'High';
    if (confidence >= 0.6) return 'Medium';
    return 'Low';
  };

  const handleFeedback = (match, action) => {
    setFeedbackDialog({
      open: true,
      match,
      action,
      explanation: ''
    });
  };

  const submitFeedback = async () => {
    try {
      setSubmitting(true);
      await authService.api.post(`/matches/${feedbackDialog.match._id}/feedback`, {
        action: feedbackDialog.action,
        explanation: feedbackDialog.explanation
      });

      setFeedbackDialog({ open: false, match: null, action: '', explanation: '' });
      await loadMatches(); // Reload matches
    } catch (error) {
      console.error('Error submitting feedback:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const closeFeedbackDialog = () => {
    setFeedbackDialog({ open: false, match: null, action: '', explanation: '' });
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Transaction Matches
      </Typography>

      <Typography variant="body1" color="textSecondary" gutterBottom>
        Review and confirm automatic matches between Fuerza Movil payments and bank transactions.
      </Typography>

      {matches.length === 0 && !loading && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No matches found. Upload files and run matching to see results.
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Fuerza Movil Transaction</TableCell>
              <TableCell>Bank Transaction</TableCell>
              <TableCell>Confidence</TableCell>
              <TableCell>Match Type</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  <LinearProgress sx={{ width: '100%' }} />
                </TableCell>
              </TableRow>
            ) : matches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  No matches to review
                </TableCell>
              </TableRow>
            ) : (
              matches.map((match) => (
                <TableRow key={match._id}>
                  <TableCell>
                    <Box>
                      <Box sx={{ mb: 1, p: 1, bgcolor: 'grey.100', borderRadius: 1 }}>
                        <Typography variant="caption" color="textSecondary" display="block">
                          Reference:
                        </Typography>
                        <Typography variant="body2" fontWeight="bold">
                          {match.fuerzaTransactionId?.reference || 'N/A'}
                        </Typography>
                        <Typography variant="caption" color="textSecondary" display="block" sx={{ mt: 0.5 }}>
                          Payment Reference:
                        </Typography>
                        <Typography variant="body2" fontWeight="bold" sx={{ color: 'primary.main' }}>
                          {match.fuerzaTransactionId?.paymentReference || 'N/A'}
                        </Typography>
                      </Box>
                      <Typography variant="body2" color="textSecondary">
                        {match.fuerzaTransactionId?.description}
                      </Typography>
                      <Typography variant="body2">
                        {formatAmount(match.fuerzaTransactionId?.amount)}
                      </Typography>
                      <Typography variant="caption" color="textSecondary">
                        {formatDate(match.fuerzaTransactionId?.date)}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box>
                      <Typography variant="body2" fontWeight="bold">
                        {match.bankTransactionId?.reference}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        {match.bankTransactionId?.description}
                      </Typography>
                      <Typography variant="body2">
                        {formatAmount(match.bankTransactionId?.amount)}
                      </Typography>
                      <Typography variant="caption" color="textSecondary">
                        {formatDate(match.bankTransactionId?.date)}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={`${(match.confidence * 100).toFixed(1)}%`}
                      color={getConfidenceColor(match.confidence)}
                      size="small"
                    />
                    <Typography variant="caption" display="block" color="textSecondary">
                      {getConfidenceLabel(match.confidence)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={match.matchType}
                      variant="outlined"
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      startIcon={<CheckIcon />}
                      onClick={() => handleFeedback(match, 'confirm')}
                      sx={{ mr: 1 }}
                    >
                      Confirm
                    </Button>
                    <Button
                      size="small"
                      startIcon={<CloseIcon />}
                      onClick={() => handleFeedback(match, 'reject')}
                      color="error"
                    >
                      Reject
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Feedback Dialog */}
      <Dialog open={feedbackDialog.open} onClose={closeFeedbackDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {feedbackDialog.action === 'confirm' ? 'Confirm Match' : 'Reject Match'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {feedbackDialog.action === 'confirm'
              ? 'Are you sure this match is correct?'
              : 'Are you sure this match is incorrect?'
            }
          </Typography>
          <TextField
            label="Explanation (optional)"
            multiline
            rows={3}
            fullWidth
            value={feedbackDialog.explanation}
            onChange={(e) => setFeedbackDialog(prev => ({
              ...prev,
              explanation: e.target.value
            }))}
            placeholder="Provide additional context for this decision..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeFeedbackDialog} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={submitFeedback}
            variant="contained"
            disabled={submitting}
            color={feedbackDialog.action === 'confirm' ? 'primary' : 'error'}
          >
            {submitting ? 'Submitting...' : feedbackDialog.action === 'confirm' ? 'Confirm' : 'Reject'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default Matches;