import { render, screen } from '@testing-library/react-native';
import HomeScreen from '../../app/index';

describe('HomeScreen', () => {
  it('home-screen testID が存在する', () => {
    render(<HomeScreen />);
    expect(screen.getByTestId('home-screen')).toBeTruthy();
  });

  it('タイトルテキストが描画される', () => {
    render(<HomeScreen />);
    // scaffold の stub テスト — Programmer が実際のタイトルに書き換えること
    expect(screen.getByTestId('home-screen')).toBeTruthy();
  });
});
