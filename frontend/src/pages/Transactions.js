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
  TextField,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { authService } from '../services/authService';

function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  useEffect(() => {
    loadTransactions();
  }, [search, typeFilter]);

  const loadTransactions = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.append('q', search);
      if (typeFilter) params.append('type', typeFilter);

      const response = await authService.api.get(`/transactions?${params}`);
      setTransactions(response.data.transactions);
    } catch (error) {
      console.error('Error loading transactions:', error);
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

  const getTypeColor = (type) => {
    return type === 'fuerza_movil' ? 'primary' : 'secondary';
  };

  const getTypeLabel = (type) => {
    return type === 'fuerza_movil' ? 'Fuerza Movil' : 'Bank';
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Transactions
      </Typography>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <TextField
            label="Search"
            variant="outlined"
            size="small"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 300 }}
          />
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Type</InputLabel>
            <Select
              value={typeFilter}
              label="Type"
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="fuerza_movil">Fuerza Movil</MenuItem>
              <MenuItem value="bank">Bank</MenuItem>
            </Select>
          </FormControl>
        </Box>

        <Typography variant="body2" color="textSecondary">
          {transactions.length} transactions found
        </Typography>
      </Paper>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell>Reference</TableCell>
              <TableCell>Description</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>File</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  No transactions found
                </TableCell>
              </TableRow>
            ) : (
              transactions.map((transaction) => (
                <TableRow key={transaction._id}>
                  <TableCell>
                    <Chip
                      label={getTypeLabel(transaction.type)}
                      color={getTypeColor(transaction.type)}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{transaction.reference}</TableCell>
                  <TableCell>{transaction.description}</TableCell>
                  <TableCell align="right">
                    {formatAmount(transaction.amount)}
                  </TableCell>
                  <TableCell>{formatDate(transaction.date)}</TableCell>
                  <TableCell>
                    {transaction.fileId?.filename || 'N/A'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export default Transactions;