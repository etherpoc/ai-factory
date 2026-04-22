import React from 'react';
import styles from './App.module.css';

export default function App(): React.JSX.Element {
  return (
    <main className={styles.container}>
      <h1 data-testid="app-title" className={styles.title}>
        UAF Desktop App
      </h1>
      <p className={styles.description}>
        Scaffold ready. Programmer agent will replace this with your feature.
      </p>
    </main>
  );
}
